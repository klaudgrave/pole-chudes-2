# Spec

- The main DOS flow is anchored in `MainThread`.
- High-level sequence:
  1. initialize sound and load assets
  2. build sprite map
  3. run splash sequence
  4. iterate tournament stages
  5. present players and collect names
  6. select a word that has not already been used in the current tournament
  7. run the stage loop until the word is solved or players are removed
  8. show interstitial/adware block between stages
  9. show final summary and update top-8 table
- The reconstructed DOS flow enumerates eight stages (`Stage 0..7`), not the five-round prototype that previously existed in the web sandbox.
- Important labeled branches to preserve:
  - `ChooseLetter`
  - `OpenLetter`
  - `SelectWord`
  - `RemovePlayer`
  - `NextPlayer`
  - `Adware`
- Special cases that belong to this subsystem:
  - box sequence after three opened letters
  - prize bargaining and possible player removal
  - repeated-word avoidance across stages
  - skipping removed players
  - all players removed before word completion
  - final top-8 insertion
