import { Wallet } from 'ethers'
import MevFlood from '../..'
import { SendRoute } from '../cliArgs'
import { now } from '../helpers'
import { SwapOptions } from '../swap'
import { FormatTypes } from 'ethers/lib/utils'

const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export enum TxStrategy {
    UniV2 = "univ2",
    UniV2Reverting = "univ2-reverting",
}

/** Sends a batch of bundles. */
export const spam = async (
    mevFlood: MevFlood,
    wallet: Wallet,
    params: {
        targetBlockNumber: number,
        txsPerBundle: number,
        sendRoute: SendRoute,
        txStrategy?: TxStrategy,
        profRpcUrl?: string,
}) => {

    console.log('Generating swaps with params:', params)
    
    const swapParams: SwapOptions = params.txStrategy === TxStrategy.UniV2Reverting ? {
        minUSD: 1000000000000, // $1T trade should revert
        swapWethForDai: false, // always swap DAI for WETH
        daiIndex: 0, // always use the first DAI contract
    } : {}

    console.log('Generating swaps with params:', swapParams)
    // calling generateSwaps with only one wallet will produce a bundle with only one tx
    const txBundles = await Promise.all(
        Array(params.txsPerBundle)
        .fill(0)
        .map((_, idx) => mevFlood.generateSwaps(
            swapParams,
            [wallet],
            idx
        )))
    const bundle = txBundles.map(txb => txb.swaps.signedSwaps.map(s => s.signedTx)).flat()

    console.log('Sending bundle:', bundle)

    if (params.sendRoute === SendRoute.Mempool) {
        mevFlood.sendToMempool(bundle).catch((e) => {console.warn("caught", e)})
    } else if (params.sendRoute === SendRoute.MevShare) {
        mevFlood.sendToMevShare(bundle, {hints: {calldata: true, logs: true}}).catch((e) => {console.warn(e)})
    } else if (params.sendRoute === SendRoute.Prof) {
        if (!params.profRpcUrl) {
            throw new Error("Prof RPC URL is required when using Prof route")
        }
        mevFlood.sendToProf(bundle, params.profRpcUrl, params.targetBlockNumber).catch((e) => {console.warn(e)})
        // mevFlood.sendToMempool(bundle).catch((e) => {console.warn("caught", e)})
    } else {
        mevFlood.sendBundle(bundle, params.targetBlockNumber).catch((e) => {console.warn(e)})
    }
}

/** Spams continuously, updating the target block if needed. */
// NOTE - currently overwrites nonce for testing! Sequencer does not interface with execution clients and does hence cannot rely on getTransactionCount()
// NOTE - TX can only be sent to PROF, not to regular mempool in parallel! Otherwise there is a nonce mismatch. 
export const spamLoop = async (mevFlood: MevFlood, wallet: Wallet, params: {
    txsPerBundle: number,
    sendRoute: SendRoute,
    secondsPerBundle: number,
    txStrategy?: TxStrategy,
    profRpcUrl?: string,
}) => {
    try {
        await wallet.provider.getBlockNumber()
    } catch {
        console.error("wallet must be connected to a provider")
        process.exit(1)
    }
    let lastBlockSampledAt = now()
    let targetBlockNumber = await wallet.provider.getBlockNumber() + 1

    while (true) {
        spam(mevFlood, wallet, {
            targetBlockNumber, 
            txsPerBundle: params.txsPerBundle, 
            sendRoute: params.sendRoute, 
            txStrategy: params.txStrategy,
            profRpcUrl: params.profRpcUrl,
        })
        await sleep(params.secondsPerBundle * 1000)
        if (now() - lastBlockSampledAt > 12000) {
            targetBlockNumber += 1
            lastBlockSampledAt = now()
        }
    }
}
