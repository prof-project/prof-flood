import { Command, Flags } from '@oclif/core'
import { providers, utils, Wallet } from 'ethers'

import MevFlood, { spam } from '../../../../core/build'
import { SendRoute } from '../../../../core/build/lib/cliArgs'
import { TxStrategy } from '../../../../core/build/lib/scripts/spam'
import { getDeploymentDir } from '../../helpers/files'
import { floodFlags } from '../../helpers/flags'

export default class Spam extends Command {
  static description = 'Send a constant stream of UniV2 swaps.'

  static flags = {
    ...floodFlags,
    txsPerBundle: Flags.integer({
      char: 't',
      description: 'Number of transactions to include in each bundle.',
      required: false,
      default: 1,
    }),
    secondsPerBundle: Flags.integer({
      char: 'p',
      description: 'Seconds to wait before sending another bundle.',
      required: false,
      default: 12,
    }),
    loadFile: Flags.string({
      char: 'l',
      description: 'Load the deployment details from a file.',
      required: false,
    }),
    revert: Flags.boolean({
      description: 'Send reverting transactions.',
      required: false,
      default: false,
    }),
    sendTo: Flags.string({
      char: 's',
      description: 'Where to send transactions. (' + Object.values(SendRoute).map(k => k.toString().toLowerCase()).filter(v => v.length > 2 /* lazy way to get rid of numbers without parsing strings into ints */).reduce((a, b) => a + ', ' + b) + ')',
      required: false,
      default: 'mempool',
    }),
    profRpcUrl: Flags.string({
      char: 'f',
      description: 'RPC URL for Prof sequencer when using prof route',
      required: false,
      default: '',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Spam)
    const provider = new providers.JsonRpcProvider(flags.rpcUrl)
    await provider.ready
    const adminWallet = new Wallet(flags.privateKey, provider)

    const adminBalance = await adminWallet.getBalance()
    if (adminBalance.eq(0)) {
      console.error(`Wallet ${adminWallet.address} has no ETH balance`)
    }

    const deployment = flags.loadFile ? await MevFlood.loadDeployment(getDeploymentDir(flags.loadFile)) : undefined
    if (!deployment) {
      console.error('No deployment loaded. Please deploy contracts first using the deploy command.')
    }

    const flood = new MevFlood(adminWallet, provider, deployment)
    console.log(`Connected to ${flags.rpcUrl} with admin wallet ${adminWallet.address}`)
    console.log(`Admin wallet balance: ${utils.formatEther(adminBalance)} ETH`)

    const txStrategy = flags.revert ? TxStrategy.UniV2Reverting : TxStrategy.UniV2
    const sendTo = flags.sendTo.toLowerCase()

    if (sendTo === 'prof' && !flags.profRpcUrl) {
      this.error('profRpcUrl is required when using prof route')
    }

    console.log("Creating spammer wallets...")
    let wallets = []
    for (let i = 0; i < 100; i++) {
        const wallet = Wallet.createRandom()
        wallets.push(new Wallet(wallet.privateKey, provider))
    }

    console.log("Funding spammer wallets...")
    await flood.fundWallets(wallets.map(wallet => wallet.address), 10000)

    await new Promise(resolve => setTimeout(resolve, 12000)) // 12 seconds 

    console.log("Checking spammer wallet balances...")
    for await (const wallet of wallets) {
      const balance = await wallet.getBalance()
      console.log(`spammer wallet ${wallet.address} has balance: ${utils.formatEther(balance)} ETH`)
    }

    this.log(`Made it to the spam loop sending to ${sendTo}`)

    await Promise.all(wallets.map((wallet) => spam.spamLoop(new MevFlood(wallet, provider, deployment), wallet, {
      txsPerBundle: flags.txsPerBundle,
      sendRoute: sendTo === 'flashbots' ? SendRoute.Flashbots : 
                 (sendTo === 'mevshare' ? SendRoute.MevShare : 
                 (sendTo === 'prof' ? SendRoute.Prof : SendRoute.Mempool)),
      secondsPerBundle: flags.secondsPerBundle,
      txStrategy,
      profRpcUrl: flags.profRpcUrl,
    })))
  }
}

