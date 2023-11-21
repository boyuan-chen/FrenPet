const { ethers, providers, Wallet } = require('ethers')
const fetch = require('node-fetch')

const graphQLNode = 'https://chubby-skate-production.up.railway.app/'
const contractAddress = '0x0e22B5f3E11944578b37ED04F5312Dfc246f443C'

const petQuery = (owner) => `
{
  pets(
    where:{
      owner_in: "${owner}"
    }
  ) {
    id
    score
    lastAttackUsed
  }
}
`
const petQueryById = (id) => `
{
  pet(id: ${id}) {
    id
    score
    lastAttackUsed
  }
}
`
const itemOwnedQuery = (id) => `
{
  pet(id: ${id}) {
    itemsOwned
  }
}
`
const leaderboardQuery = () => `
{
  pets (
    first: 1000,
    where: {
      owner_not: "0x0000000000000000000000000000000000000000"
    },
    orderBy: "level",
    orderDirection: "desc"
  ) {
    name
    id
    owner
    score
    timeUntilStarving
    status
    lastAttackUsed
    lastAttacked
    level
  }
}
`

const sleep = async (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

require('dotenv').config()
const env = process.env

const main = async () => {
  const web3 = new ethers.providers.JsonRpcProvider(env.NODE_URL)
  const wallet = new Wallet(env.PRIVATE_KEY, web3)

  console.log(`Wallet address: ${wallet.address}`)

  while (true) {
    let pets = []
    try {
      const petsResponse = await fetch(graphQLNode, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: petQuery(wallet.address) }),
      })
      const petsJson = await petsResponse.json()
      pets = petsJson.data.pets
    } catch (e) {
      console.log(`Error fetching pets: ${e}`)
    }

    for (let i = 0; i < pets.length; i++) {
      const pet = pets[i]
      const petId = pet.id
      const petScore = pet.score
      const lastAttackUsed = pet.lastAttackUsed

      // we can attack if last attack was more than 15 minutes ago
      const now = Math.floor(Date.now() / 1000)
      const canAttack = (now - lastAttackUsed) > 15 * 60
      // -----------------------------------------------------------------------------
      if (!canAttack) {
        console.log(`-> Pet ${petId} cannot attack yet waiting ${15 * 60 - (now - lastAttackUsed)} seconds`)
        continue
      }

      console.log(`Pet ${petId} can attack!`)

      const leaderboardResponse = await fetch(graphQLNode, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: leaderboardQuery() }),
      })
      const leaderboardJson = await leaderboardResponse.json()
      const leaderboard = leaderboardJson.data.pets
      for (const leaderboardPet of leaderboard) {
        const lastAttacked = leaderboardPet.lastAttacked
        const status = leaderboardPet.status
        const now = Math.floor(Date.now() / 1000)
        if (lastAttacked + 60 * 60 < now && status === 0) {
          const itemsOwnedResponse = await fetch(graphQLNode, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: itemOwnedQuery(leaderboardPet.id) }),
          })
          const itemsOwnedJson = await itemsOwnedResponse.json()
          const itemsOwned = itemsOwnedJson.data.pet.itemsOwned
          if (!itemsOwned.includes(6)) {
            console.log(`Attacking pet ${leaderboardPet.id}`)
            const contract = new ethers.Contract(contractAddress, [
              'function attack(uint256 fromId, uint256 toId) external',
            ], wallet)
            try {
              const tx = await contract.attack(petId, leaderboardPet.id)
              console.log(`-> Transaction hash: ${tx.hash}`)
              const receipt = await tx.wait()
              console.log(`-> Transaction confirmed in block ${receipt.blockNumber}`)
              const updatedPetResponse = await fetch(graphQLNode, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: petQueryById(petId) }),
              })
              const updatedPetJson = await updatedPetResponse.json()
              const updatedPet = updatedPetJson.data.pet
              const updatedPetScore = updatedPet.score
              const updatedScore = ethers.BigNumber.from(updatedPetScore).sub(ethers.BigNumber.from(petScore))
              const formatedScore = ethers.utils.formatUnits(updatedScore, 12)
              console.log(`-> Pet ${petId} won score: ${formatedScore.toString()}`)
              break
            } catch (e) {
              console.log(`-> !!!Error attacking pet ${leaderboardPet.id}: ${e}`)
            }
          }
        }
      }
    }

    await sleep(5000)
  }
}

main()