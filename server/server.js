// server/server.js
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const PORT = process.env.PORT || 8787;

const STOCKS = [
  { id: "BP", name: "British Petroleum" },
  { id: "VOW", name: "Volkswagen" },
  { id: "DB", name: "Deutsche Bank" },
  { id: "IBM", name: "IBM" }
];

const CARD_TYPES = [1, 2, 3, 4, 5];

function code6() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function uid() {
  return crypto.randomBytes(10).toString("hex");
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function clampIntPrice(x) {
  return Math.max(0, Math.round(x));
}

// 8 carte: 1xT1, 2xT2, 1xT3, 1xT4, 1xT5 (=6) + 2 random
function buildStartingDeck8() {
  const base = [1, 2, 2, 3, 4, 5];
  const extra1 = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
  const extra2 = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
  const types = shuffle([...base, extra1, extra2]);
  return types.map((t) => ({ id: uid(), type: t }));
}

function createRoom() {
  const roomCode = code6();
  return {
    code: roomCode,
    createdAt: Date.now(),
    phase: "lobby", // lobby | playing | ended
    hostPlayerId: null,

    turnOrder: [],
    turnIndex: 0,
    round: 0, // 0..6 complete cycles
    maxRounds: 6,

    stocks: STOCKS.map((s) => ({ ...s, price: 100 })),
    players: {}, // playerId -> player
    logs: []
  };
}

function publicRoomState(room, viewerPlayerId) {
  const playersArr = Object.values(room.players).map((p) => {
    const isViewer = p.id === viewerPlayerId;
    return {
      id: p.id,
      name: p.name,
      cash: p.cash,
      holdings: p.holdings,
      // carte visibili solo al proprietario
      cards: isViewer ? p.cards : undefined,
      cardCount: p.cards.length,
      connected: p.connected
    };
  });

  return {
    code: room.code,
    phase: room.phase,
    hostPlayerId: room.hostPlayerId,
    turnOrder: room.turnOrder,
    turnIndex: room.turnIndex,
    currentPlayerId: room.turnOrder[room.turnIndex] || null,
    round: room.round,
    maxRounds: room.maxRounds,
    stocks: room.stocks,
    players: playersArr,
    logs: room.logs.slice(-80)
  };
}

function ensureCanJoin(room) {
  const n = Object.keys(room.players).length;
  return room.phase === "lobby" && n < 8;
}
function ensureCanStart(room) {
  const n = Object.keys(room.players).length;
  return room.phase === "lobby" && n >= 2 && n <= 8;
}

function initGame(room) {
  room.phase = "playing";
  room.round = 0;
  room.turnIndex = 0;

  const playerIds = shuffle(Object.keys(room.players));
  room.turnOrder = playerIds;

  room.stocks = STOCKS.map((s) => ({ ...s, price: 100 }));

  for (const pid of playerIds) {
    const p = room.players[pid];
    p.cash = 300;
    p.holdings = { BP: 0, VOW: 0, DB: 0, IBM: 0 };
    p.cards = buildStartingDeck8();
    p.turn = {
      cardPlayed: false,
      tradedDir: { BP: null, VOW: null, DB: null, IBM: null } // "buy"|"sell"|null
    };
  }

  room.logs.push({
    t: Date.now(),
    msg: `Partita iniziata. Ordine turni: ${playerIds
      .map((id) => room.players[id].name)
      .join(" → ")}`
  });
}

function getStock(room, stockId) {
  const s = room.stocks.find((x) => x.id === stockId);
  if (!s) throw new Error("Titolo non valido");
  return s;
}

function isPlayersTurn(room, playerId) {
  return room.phase === "playing" && room.turnOrder[room.turnIndex] === playerId;
}

function applyBoundaryEvents(room) {
  for (const stock of room.stocks) {
    if (stock.price > 250) {
      const dividendPerShare = stock.price - 250;
      let totalPaid = 0;
      for (const p of Object.values(room.players)) {
        const shares = p.holdings[stock.id] || 0;
        if (shares > 0) {
          const pay = shares * dividendPerShare;
          p.cash += pay;
          totalPaid += pay;
        }
      }
      room.logs.push({
        t: Date.now(),
        msg: `DIVIDENDO ${stock.name}: +$${dividendPerShare}/azione (totale pagato $${totalPaid}). Prezzo reset a $250.`
      });
      stock.price = 250;
    } else if (stock.price < 10) {
      let confiscated = 0;
      for (const p of Object.values(room.players)) {
        const shares = p.holdings[stock.id] || 0;
        if (shares > 0) {
          confiscated += shares;
          p.holdings[stock.id] = 0;
        }
      }
      room.logs.push({
        t: Date.now(),
        msg: `CONFISCA ${stock.name}: prezzo < $10. Confiscate ${confiscated} azioni totali. Prezzo reset a $10.`
      });
      stock.price = 10;
    }

    // non permettere permanenza fuori range
    if (stock.price > 250) stock.price = 250;
    if (stock.price < 10) stock.price = 10;
  }
}

function applyCardEffect(room, playerId, cardId, determinedStockId, chosenStockId) {
  const p = room.players[playerId];
  const cardIndex = p.cards.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) throw new Error("Carta non posseduta");

  const card = p.cards[cardIndex];
  if (!CARD_TYPES.includes(card.type)) throw new Error("Tipo carta non valido");
  if (determinedStockId === chosenStockId) throw new Error("Scegli due titoli diversi");

  const det = getStock(room, determinedStockId);
  const cho = getStock(room, chosenStockId);

  // rimuovi carta (esattamente 1 per turno)
  p.cards.splice(cardIndex, 1);

  const before = room.stocks.map((s) => ({ id: s.id, price: s.price }));

  // Type 1: +60 det, -30 chosen
  // Type 2: -50 det, +40 chosen
  // Type 3: +100 det, -10 altri
  // Type 4: det ×2, chosen ÷2
  // Type 5: det ÷2, chosen ×2
  if (card.type === 1) {
    det.price = clampIntPrice(det.price + 60);
    cho.price = clampIntPrice(cho.price - 30);
  } else if (card.type === 2) {
    det.price = clampIntPrice(det.price - 50);
    cho.price = clampIntPrice(cho.price + 40);
  } else if (card.type === 3) {
    det.price = clampIntPrice(det.price + 100);
    for (const s of room.stocks) {
      if (s.id !== det.id) s.price = clampIntPrice(s.price - 10);
    }
  } else if (card.type === 4) {
    det.price = clampIntPrice(det.price * 2);
    cho.price = clampIntPrice(cho.price / 2);
  } else if (card.type === 5) {
    det.price = clampIntPrice(det.price / 2);
    cho.price = clampIntPrice(cho.price * 2);
  }

  applyBoundaryEvents(room);

  const after = room.stocks.map((s) => ({ id: s.id, price: s.price }));

  room.logs.push({
    t: Date.now(),
    msg: `${p.name} ha giocato Carta T${card.type}: ${det.name} (det) & ${cho.name} (scelto). Prezzi: ${before
      .map((b) => `${b.id} $${b.price}`)
      .join(", ")} → ${after.map((a) => `${a.id} $${a.price}`).join(", ")}`
  });

  p.turn.cardPlayed = true;
}

function trade(room, playerId, side, stockId, qty) {
  const p = room.players[playerId];
  const stock = getStock(room, stockId);

  qty = Math.floor(qty);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantità non valida");

  // vincolo: non buy-then-sell o sell-then-buy stesso titolo nello stesso turno
  const prevDir = p.turn.tradedDir[stockId];
  if (prevDir && prevDir !== side) {
    throw new Error("Non puoi comprare e vendere lo stesso titolo nello stesso turno.");
  }
  p.turn.tradedDir[stockId] = side;

  const amount = stock.price * qty;

  if (side === "buy") {
    if (p.cash < amount) throw new Error("Cash insufficiente");
    p.cash -= amount;
    p.holdings[stockId] += qty;
    room.logs.push({
      t: Date.now(),
      msg: `${p.name} COMPRA ${qty} ${stock.name} @ $${stock.price} (speso $${amount}).`
    });
  } else if (side === "sell") {
    if (p.holdings[stockId] < qty) throw new Error("Azioni insufficienti");
    p.holdings[stockId] -= qty;
    p.cash += amount;
    room.logs.push({
      t: Date.now(),
      msg: `${p.name} VENDE ${qty} ${stock.name} @ $${stock.price} (incassato $${amount}).`
    });
  } else {
    throw new Error("Side non valido");
  }
}

function endTurn(room, playerId) {
  const p = room.players[playerId];
  if (!p.turn.cardPlayed) throw new Error("Devi giocare esattamente 1 carta prima di chiudere il turno.");

  // reset stato turno per il prossimo giro
  p.turn = {
    cardPlayed: false,
    tradedDir: { BP: null, VOW: null, DB: null, IBM: null }
  };

  room.turnIndex += 1;

  // ciclo finito => incrementa round
  if (room.turnIndex >= room.turnOrder.length) {
    room.turnIndex = 0;
    room.round += 1;
    room.logs.push({ t: Date.now(), msg: `--- Fine round ${room.round} / ${room.maxRounds} ---` });
  }

  // fine partita dopo 6 cicli completi
  if (room.round >= room.maxRounds) {
    room.phase = "ended";

    const standings = Object.values(room.players)
      .map((pl) => {
        let stockValue = 0;
        for (const s of room.stocks) stockValue += (pl.holdings[s.id] || 0) * s.price;
        const total = pl.cash + stockValue;
        return { id: pl.id, name: pl.name, cash: pl.cash, stockValue, total };
      })
      .sort((a, b) => b.total - a.total);

    const winner = standings[0];
    room.logs.push({
      t: Date.now(),
      msg: `FINE PARTITA. Vince ${winner.name} con $${winner.total} (cash $${winner.cash}, titoli $${winner.stockValue}).`
    });

    // opzionale: salva standings per client (se vuoi usarli)
    room.finalStandings = standings;
  }
}

/** STORE **/
const rooms = new Map(); // code -> room
const sockets = new Map(); // ws -> { roomCode, playerId }

function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, payload }));
}

function broadcastRoom(room) {
  for (const [ws, info] of sockets.entries()) {
    if (info.roomCode !== room.code) continue;
    if (ws.readyState !== ws.OPEN) continue;
    ws.send(
      JSON.stringify({
        type: "ROOM_STATE",
        payload: publicRoomState(room, info.playerId)
      })
    );
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("La Borsa server OK");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, "ERROR", { message: "JSON non valido" });
    }

    const { type, payload } = msg || {};

    try {
      // CREATE LOBBY
      if (type === "CREATE_LOBBY") {
        const name = (payload?.name || "").trim().slice(0, 24);
        if (!name) throw new Error("Nome richiesto");

        // genera codice unico
        let room = createRoom();
        while (rooms.has(room.code)) room = createRoom();

        const playerId = uid();
        room.hostPlayerId = playerId;
        room.players[playerId] = {
          id: playerId,
          name,
          cash: 0,
          holdings: { BP: 0, VOW: 0, DB: 0, IBM: 0 },
          cards: [],
          connected: true,
          turn: {
            cardPlayed: false,
            tradedDir: { BP: null, VOW: null, DB: null, IBM: null }
          }
        };

        rooms.set(room.code, room);
        sockets.set(ws, { roomCode: room.code, playerId });

        send(ws, "JOINED", { roomCode: room.code, playerId, isHost: true });
        broadcastRoom(room);
        return;
      }

      // JOIN LOBBY
      if (type === "JOIN_LOBBY") {
        const code = (payload?.code || "").trim().toUpperCase();
        const name = (payload?.name || "").trim().slice(0, 24);
        if (!code || !name) throw new Error("Code e nome richiesti");

        const room = rooms.get(code);
        if (!room) throw new Error("Lobby non trovata");
        if (!ensureCanJoin(room)) throw new Error("Lobby piena o partita già iniziata");

        const playerId = uid();
        room.players[playerId] = {
          id: playerId,
          name,
          cash: 0,
          holdings: { BP: 0, VOW: 0, DB: 0, IBM: 0 },
          cards: [],
          connected: true,
          turn: {
            cardPlayed: false,
            tradedDir: { BP: null, VOW: null, DB: null, IBM: null }
          }
        };

        sockets.set(ws, { roomCode: room.code, playerId });

        send(ws, "JOINED", { roomCode: room.code, playerId, isHost: playerId === room.hostPlayerId });
        room.logs.push({ t: Date.now(), msg: `${name} è entrato nella lobby.` });
        broadcastRoom(room);
        return;
      }

      // dopo qui serve sessione
      const sess = sockets.get(ws);
      if (!sess) throw new Error("Non sei in una lobby");
      const room = rooms.get(sess.roomCode);
      if (!room) throw new Error("Lobby non trovata");

      const playerId = sess.playerId;

      if (type === "START_GAME") {
        if (playerId !== room.hostPlayerId) throw new Error("Solo l'host può avviare");
        if (!ensureCanStart(room)) throw new Error("Servono 2–8 giocatori per iniziare");
        initGame(room);
        broadcastRoom(room);
        return;
      }

      if (type === "TRADE") {
        if (!isPlayersTurn(room, playerId)) throw new Error("Non è il tuo turno");
        trade(room, playerId, payload?.side, payload?.stockId, payload?.qty);
        broadcastRoom(room);
        return;
      }

      if (type === "PLAY_CARD") {
        if (!isPlayersTurn(room, playerId)) throw new Error("Non è il tuo turno");
        const p = room.players[playerId];
        if (p.turn.cardPlayed) throw new Error("Hai già giocato una carta in questo turno");
        applyCardEffect(room, playerId, payload?.cardId, payload?.determinedStockId, payload?.chosenStockId);
        broadcastRoom(room);
        return;
      }

      if (type === "END_TURN") {
        if (!isPlayersTurn(room, playerId)) throw new Error("Non è il tuo turno");
        endTurn(room, playerId);
        broadcastRoom(room);
        return;
      }

      if (type === "LEAVE") {
        if (room.players[playerId]) {
          room.players[playerId].connected = false;
          room.logs.push({ t: Date.now(), msg: `${room.players[playerId].name} si è disconnesso.` });
        }
        sockets.delete(ws);
        broadcastRoom(room);
        return;
      }

      throw new Error("Tipo messaggio non supportato");
    } catch (e) {
      send(ws, "ERROR", { message: e?.message || "Errore" });
    }
  });

  ws.on("close", () => {
    const sess = sockets.get(ws);
    if (!sess) return;
    const room = rooms.get(sess.roomCode);
    if (room && room.players[sess.playerId]) {
      room.players[sess.playerId].connected = false;
      room.logs.push({ t: Date.now(), msg: `${room.players[sess.playerId].name} si è disconnesso.` });
      broadcastRoom(room);
    }
    sockets.delete(ws);
  });

  send(ws, "HELLO", { serverTime: Date.now() });
});

server.listen(PORT, () => {
  console.log(`La Borsa server listening on http://localhost:${PORT}`);
});
