import {Command, Flags} from '@oclif/core'
import {providers, Wallet, utils} from 'ethers'

import {floodFlags} from '../../helpers/flags'
import MevFlood, {spam} from '../../../../core/build'
import {SendRoute} from '../../../../core/build/lib/cliArgs'
import {getDeploymentDir} from '../../helpers/files'
import {TxStrategy} from '../../../../core/build/lib/scripts/spam'

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
    const wallet = new Wallet(flags.privateKey, provider)

    const balance = await wallet.getBalance()
    if (balance.eq(0)) {
      this.error(`Wallet ${wallet.address} has no ETH balance`)
    }

    const deployment = flags.loadFile ? await MevFlood.loadDeployment(getDeploymentDir(flags.loadFile)) : undefined
    if (!deployment) {
      this.error('No deployment loaded. Please deploy contracts first using the deploy command.')
    }

    // const pairAddress = deployment.pairs[0]
    // const code = await provider.getCode(pairAddress)
    // if (code === '0x') {
    //   this.error(`UniV2 pair contract not found at ${pairAddress}`)
    // }

    const flood = new MevFlood(wallet, provider, deployment)
    this.log(`Connected to ${flags.rpcUrl} with wallet ${wallet.address}`)
    this.log(`Wallet balance: ${utils.formatEther(balance)} ETH`)

    const txStrategy = flags.revert ? TxStrategy.UniV2Reverting : TxStrategy.UniV2
    const sendTo = flags.sendTo.toLowerCase()

    if (sendTo === 'prof' && !flags.profRpcUrl) {
      this.error('profRpcUrl is required when using prof route')
    }

    this.log(`Made it to the spam loop sending to ${sendTo}`)

    await spam.spamLoop(flood, wallet, {
      txsPerBundle: flags.txsPerBundle,
      sendRoute: sendTo === 'flashbots' ? SendRoute.Flashbots : 
                 (sendTo === 'mevshare' ? SendRoute.MevShare : 
                 (sendTo === 'prof' ? SendRoute.Prof : SendRoute.Mempool)),
      secondsPerBundle: flags.secondsPerBundle,
      txStrategy,
      profRpcUrl: flags.profRpcUrl,
    })
  }
}

