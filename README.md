# Poker

No-limit Texas Hold'em for 2–10 players, played online on phones with family and friends. One person creates a table and shares the link on WhatsApp; everyone else opens it and types their name. There is nothing to install and no accounts. **Play chips only: no real money is involved anywhere.**

## Rules (as built)

- **Texas Hold'em, no limit.** Two cards each, five shared cards (flop, turn, river), a betting round before the flop and after each street. Best five-card hand wins; equal hands split the pot.
- **Blinds and the button.** The dealer button moves one seat each hand. The two players to its left post the small and big blind; heads-up, the button posts the small blind and acts first before the flop.
- **Betting, as in a cardroom:** a raise must be at least the last full bet or raise; an all-in for less than a full raise doesn't reopen the betting for players who have already acted; a bet nobody calls goes back to the bettor; a short all-in big blind still has to be called in full.
- **All-ins and side pots.** You can only win from each player what you put in yourself. When nobody can bet any more, everyone's cards are turned up and the board is dealt out one street at a time.
- **Split pots** share chips equally; an odd chip goes to the first winner left of the button.
- **Two kinds of game** (the host picks in the lobby):
  - **Cash game** (default): run out of chips and you can rebuy for the starting stack. Fixed blinds. Latecomers can sit down between hands. The host ends the game, and whoever is up the most chips wins.
  - **Tournament:** no rebuys, the blinds go up every 10/15/20/30 minutes, last player with chips wins. Players knocked out in the same hand are placed by who started it with more chips.
- **Starting chips** 500 to 10,000 and **blinds** 5/10 to 100/200, set by the host.

## Features

- **Rooms:** 4-letter room codes and share links (`https://…/ABCD`), with WhatsApp, Share and Copy link buttons.
- **Made for people new to poker:** your best hand is always spelled out under your cards ("Two Pair, Kings and Fives"), the winning five cards light up at a showdown, and How to play shows every hand ranking with real cards.
- **Betting controls:** Fold / Check / Call, and a raise slider with Min, ½ pot, ¾ pot, Pot and All in. Going all in takes two taps. While you wait, tick **Check / Fold** or **Check** and it happens on your turn.
- **Computer players** to fill seats or practise alone, named after Bollywood villains (Gabbar, Mogambo, Shakaal…). They only use what a person in their seat would know.
- **Hidden cards stay hidden:** the server deals and decides everything and sends each phone only its own cards.
- **Reconnecting:** a reload or a dropped connection puts you back in your seat. If you're offline or out of time you check (or fold), and after that you sit out until you're back.
- **Host controls:** turn timer, pause/resume, skip a slow player, add a computer player, remove a player, make someone else host, end the game. The host role moves on if the host is offline for 30 seconds. Someone whose phone died can take their seat back on another device once the host agrees.
- **On screen:** hand history, standings (chips, buy-ins, +/−), Indian number formats (1,00,000), sounds, vibration, chip and card animations. The screen stays awake during a game.

## Put it online (Render, about 10 minutes)

This works exactly like Kabo; it is a second free service.

1. Merge the pull request so the code is on `main`.
2. Go to [dashboard.render.com](https://dashboard.render.com) (sign in with GitHub) and let Render see the `Poker` repo.
3. Click **New → Blueprint**, pick `Poker`, then **Apply**. `render.yaml` sets everything up: Node, Singapore region (the closest to India), free plan.
4. When the deploy finishes, open the `https://poker-….onrender.com` link it shows. That's the link to share.

Notes:

- **The free plan sleeps** after 15 minutes with nobody connected, and the first visit then takes about a minute to wake it. Render can also restart free servers, which ends games in progress. For game nights, switch the instance type to Starter (about $7/month) under the service's Settings, and back to free afterwards if you like.
- **Every merge to `main` redeploys** and restarts the server, which ends games in progress. Don't deploy during a game.
- Games live in memory only. Nothing is stored and there are no accounts.

## Run it locally

```sh
npm install
npm start          # http://localhost:3000
npm test           # hand evaluator, rules, randomised games and socket tests
```

Phones on the same Wi-Fi can join at `http://<your-computer's-IP>:3000`.

## Code map

- `server/hand.js`: the hand evaluator. Scores any 5–7 cards as one number; checked against all 2,598,960 five-card hands.
- `server/game.js`: the Hold'em rules engine, a pure state machine (blinds, betting, side pots, showdown, rebuys, tournaments). `viewFor(player)` is the only way state reaches a client.
- `server/bot.js`: computer players (a preflop hand rating, then simulated odds against the players still in).
- `server/rooms.js`: rooms, seats, host controls, turn timers, dealing the next hand, blind levels, reconnects and the socket API.
- `server/index.js`: the Express + Socket.IO server.
- `public/`: the phone web app, plain ES modules with no build step.
- `test/`: evaluator and rules unit tests, randomised games that check no chip or card is ever lost or leaked, and end-to-end socket tests.
