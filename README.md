# Royalty Splitter Merkle

On-chain royalty splitter for TON with a **push** + **pull** payout model:

- **Push**: creator (или коллекция) периодически заливает роялти на контракт и вызывает `set_epoch`. Контракт:
  - забирает текущий `pool = balance - keepAlive`;
  - делит его по фиксированному сплиту (по умолчанию 50/50) между **создателем** и **холдерами**;
  - запоминает `perShare` и Merkle root для текущей эпохи;
  - обнуляет словарь `claimed` для новой эпохи.

- **Pull**: каждый холдер сам забирает свою долю через `claim`:
  - off-chain код строит Merkle–дерево по списку `(index, owner)` и знает proof для каждого холдера;
  - on-chain контракт проверяет proof и переводит фиксированный `perShare` этому адресу;
  - повторный `claim` для того же `index` запрещён.

Контракт написан на **FunC**, поверх стандартной TON stdlib.

---

## Design

### Storage layout

```text
data = cell {
  owner:      MsgAddress    ;; кто может вызывать set_epoch
  creator:    MsgAddress    ;; кому уходит creator-часть пула
  keepAlive:  Coins         ;; минимальный остаток на контракте
  minPayout:  Coins         ;; минимальная выплата холдеру
  epochId:    uint32        ;; номер текущей эпохи
  perShare:   Coins         ;; сколько получает один "лист" в дереве
  claimed:    dict(uint32 -> bit) ;; кто уже клеймил в этой эпохе
  rootHash:   uint256       ;; Merkle root для текущей эпохи
}
