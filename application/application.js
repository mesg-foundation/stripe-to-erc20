const { application } = require('mesg-js')
const BigNumber = require('bignumber.js')

const mesg = application({ endpoint: process.env.MESG_ENDPOINT })

const TOKEN_PRICE = 0.4
const ERC20_ADDRESS = '0xd14A3D6b94016e455af5eB7F329bc572EA626c5F'
const ERC20_DECIMALS = BigNumber(10).pow(18)
const emails = {}

const main = async () => {
  const WEBHOOK = mesg.resolve('webhook')
  const STRIPE = mesg.resolve('stripe')
  const ERC20 = mesg.resolve('ethereum-erc20')
  const EMAIL = mesg.resolve('email-sendgrid')

  const log = x => x.on('data', console.log).on('error', console.error)
  log(mesg.listenResult({ filter: { instanceHash: STRIPE } }))
  log(mesg.listenResult({ filter: { instanceHash: ERC20 } }))

  mesg.listenEvent({ filter: { instanceHash: WEBHOOK, key: 'request' } })
    .on('data', event => {
      const { data } = mesg.decodeData(event.data)
      console.log('Receiving webhook => Charging on Stripe', data)
      emails[data.ethAddress.toUpperCase()] = data.email
      mesg.executeTask({
        instanceHash: STRIPE,
        taskKey: 'charge',
        inputs: mesg.encodeData({
          amount: data.number * TOKEN_PRICE * 100,
          currency: 'usd',
          email: data.email,
          metadata: {
            address: data.ethAddress,
            tokens: data.number
          },
          source: data.token,
          stripeSecretKey: process.env.STRIPE_SECRET
        })
      })
        .catch(console.error)
    })

  mesg.listenEvent({ filter: { instanceHash: STRIPE, eventKey: 'charged' } })
    .on('data', event => {
      const { metadata } = mesg.decodeData(event.data)
      console.log('Stripe payment confirmed => Transfering ERC20', metadata)
      mesg.executeTask({
        instanceHash: ERC20,
        taskKey: 'transfer',
        input: mesg.encodeData({
          contractAddress: ERC20_ADDRESS,
          privateKey: process.env.PRIVATE_KEY,
          gasLimit: 100000,
          to: metadata.address,
          value: (metadata.tokens * ERC20_DECIMALS).toString()
        })
      })
        .catch(console.error)
    })


  mesg.listenEvent({ filter: { instanceHash: ERC20, eventKey: 'transfer' } })
    .on('data', event => {
      const transfer = mesg.decodeData(event.data)
      if (
        transfer.contractAddress.toUpperCase() === ERC20_ADDRESS.toUpperCase() &&
        transfer.to &&
        emails[transfer.to.toUpperCase()]
      ) {
        console.log('ERC20 received => Send email', transfer)
        mesg.executeTask({
          instanceHash: EMAIL,
          taskKey: 'send',
          input: mesg.decodeData({
            apiKey: process.env.SENDGRID_API_KEY,
            from: 'contact@mesg.com',
            to: emails[transfer.to.toUpperCase()],
            subject: `Your MESG tokens just arrived`,
            text: `Hello, you just received your ${BigNumber(transfer.value).dividedBy(ERC20_DECIMALS).toString()} MESG tokens. See the details of the transaction here https://ropsten.etherscan.io/tx/${transfer.transactionHash}`
          })
        })
          .catch(console.error)
      }
    })
}

main()