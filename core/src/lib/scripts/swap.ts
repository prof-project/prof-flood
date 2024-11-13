import { Contract, providers, Wallet } from 'ethers'
import { formatEther } from 'ethers/lib/utils'
import contracts from '../contracts'
import { LiquidDeployment } from '../liquid'
import { createRandomSwapParams, signSwap, SwapOptions, SwapParams } from '../swap'

export const createSwaps = async (options: SwapOptions, provider: providers.JsonRpcProvider, userWallets: Wallet[], deployment: LiquidDeployment, nonce: {offset?: number, override?: number}) => {
    let signedSwaps: {signedTx: string, tx: providers.TransactionRequest}[] = []
    let swapParams: SwapParams[] = []
    for (const wallet of userWallets) {
        try {
            console.log('Contract Addresses:')
            console.log('AtomicSwap:', deployment.atomicSwap.contractAddress)
            console.log('UniV2FactoryA:', deployment.uniV2FactoryA.contractAddress)
            console.log('UniV2FactoryB:', deployment.uniV2FactoryB.contractAddress)
            console.log('WETH:', deployment.weth.contractAddress)
            console.log('DAI addresses:', deployment.dai.map(c => c.contractAddress))

            const atomicSwapContract = new Contract(deployment.atomicSwap.contractAddress, contracts.AtomicSwap.abi)
            const swap = await createRandomSwapParams(
                provider,
                deployment.uniV2FactoryA.contractAddress,
                deployment.uniV2FactoryB.contractAddress,
                deployment.dai.map(c => c.contractAddress),
                deployment.weth.contractAddress,
                options
            )
            // Validate that the swap was created successfully
            // if (!swap || !swap.path || swap.path.length === 0) {
            //     console.error(`Failed to create valid swap params for wallet ${wallet.address}`)
            //     continue
            // }
            
            swapParams.push(swap)
            const wethForDai = swap.path[0].toLowerCase() === deployment.weth.contractAddress.toLowerCase()
            console.log(`[${wallet.address}] swapping ${formatEther(swap.amountIn)} ${wethForDai ? "WETH" : "DAI"} for ${wethForDai ? "DAI" : "WETH"}`)
            const currentNonce = await wallet.getTransactionCount()
            console.log('Nonce calculation debug:')
            console.log('- currentNonce (from getTransactionCount):', currentNonce)
            console.log('- nonce.override:', nonce.override)
            console.log('- nonce.offset:', nonce.offset)
            console.log('- Final nonce value:', (nonce.override ? currentNonce + nonce.override : (currentNonce + (nonce.offset || 0))))
            
            const signedSwap = await signSwap(
                atomicSwapContract,
                swap.uniFactoryAddress,
                wallet,
                swap.amountIn,
                swap.path,
                (nonce.override ? currentNonce + nonce.override : (currentNonce + (nonce.offset || 0))),
                provider.network.chainId,
                options.gasFees
            )
            signedSwaps.push(signedSwap)
        } catch (error) {
            console.error(`Error creating swap for wallet ${wallet.address}:`, error)
            continue
        }
    }
    return {signedSwaps, swapParams}
}
