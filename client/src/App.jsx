import { useEffect, useMemo, useRef, useState } from "react";

const WS_URL =
  import.meta.env.VITE_WS_URL || "ws://localhost:8787";

function fmt(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export default function App() {
  const wsRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const [selectedCard, setSelectedCard] = useState(null);
  const [detStock, setDetStock] = useState("BP");
  const [choStock, setChoStock] = useState("VOW");
  const [tradeQty, setTradeQty] = useState(1);
  const [tradeStock, setTradeStock] = useState("BP");
  const [tradeSide, setTradeSide] = useState("buy");

  const me = useMemo(() => {
    if (!room || !playerId) return null;
    return room.players.find((p) => p.id === playerId);
  }, [room, playerId]);

  const isMyTurn =
    room?.phase === "playing" &&
    room?.currentPlayerId === playerId;

  function send(type, payload) {
    wsRef.current?.send(JSON.stringify({ type, payload }));
  }

  function connect() {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "ERROR") {
        setError(msg.payload.message);
      }
      if (msg.type === "JOINED") {
        setPlayerId(msg.payload.playerId);
      }
      if (msg.type === "ROOM_STATE") {
        setRoom(msg.payload);
      }
    };

    wsRef.current = ws;
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>La Borsa</h1>

      {!connected && (
        <button onClick={connect}>Connetti</button>
      )}

      {error && (
        <div style={{ color: "red" }}>{error}</div>
      )}

      {!room && (
        <div style={{ marginTop: 20 }}>
          <input
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={() =>
              send("CREATE_LOBBY", { name })
            }
          >
            Crea Lobby
          </button>
          <input
            placeholder="Room code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value)
            }
          />
          <button
            onClick={() =>
              send("JOIN_LOBBY", { code, name })
            }
          >
            Entra
          </button>
        </div>
      )}

      {room && (
        <div>
          <h2>
            Room {room.code} — {room.phase}
          </h2>

          {room.phase === "lobby" &&
            playerId === room.hostPlayerId && (
              <button
                onClick={() =>
                  send("START_GAME", {})
                }
              >
                Avvia Partita
              </button>
            )}

          <h3>Mercato</h3>
          {room.stocks.map((s) => (
            <div key={s.id}>
              {s.name}: {fmt(s.price)}
            </div>
          ))}

          <h3>Giocatori</h3>
          {room.players.map((p) => (
            <div key={p.id}>
              {p.name} — Cash: {fmt(p.cash)} —
              Carte: {p.cardCount}
              {p.id === room.currentPlayerId &&
                " (TURN)"}
            </div>
          ))}

          {me && (
            <>
              <h3>Le tue carte</h3>
              {me.cards?.map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    setSelectedCard(c.id)
                  }
                >
                  T{c.type}
                </button>
              ))}

              {isMyTurn && (
                <>
                  <h3>Gioca carta</h3>
                  <select
                    value={detStock}
                    onChange={(e) =>
                      setDetStock(
                        e.target.value
                      )
                    }
                  >
                    {room.stocks.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                      >
                        {s.id}
                      </option>
                    ))}
                  </select>

                  <select
                    value={choStock}
                    onChange={(e) =>
                      setChoStock(
                        e.target.value
                      )
                    }
                  >
                    {room.stocks.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                      >
                        {s.id}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() =>
                      send("PLAY_CARD", {
                        cardId:
                          selectedCard,
                        determinedStockId:
                          detStock,
                        chosenStockId:
                          choStock
                      })
                    }
                  >
                    Gioca
                  </button>

                  <h3>Trade</h3>
                  <select
                    value={tradeSide}
                    onChange={(e) =>
                      setTradeSide(
                        e.target.value
                      )
                    }
                  >
                    <option value="buy">
                      Buy
                    </option>
                    <option value="sell">
                      Sell
                    </option>
                  </select>

                  <select
                    value={tradeStock}
                    onChange={(e) =>
                      setTradeStock(
                        e.target.value
                      )
                    }
                  >
                    {room.stocks.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                      >
                        {s.id}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    value={tradeQty}
                    onChange={(e) =>
                      setTradeQty(
                        e.target.value
                      )
                    }
                  />

                  <button
                    onClick={() =>
                      send("TRADE", {
                        side: tradeSide,
                        stockId:
                          tradeStock,
                        qty: tradeQty
                      })
                    }
                  >
                    Esegui
                  </button>

                  <button
                    onClick={() =>
                      send("END_TURN", {})
                    }
                  >
                    Fine Turno
                  </button>
                </>
              )}
            </>
          )}

          <h3>Log</h3>
          {room.logs.map((l, i) => (
            <div key={i}>
              {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
