import { useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8787";

export default function App() {
  const [ws, setWs] = useState(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState([]);

  function connect() {
    const socket = new WebSocket(WS_URL);

    socket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "CREATED") setCode(data.code);
      if (data.type === "MSG") setLog((l) => [...l, data.text]);
    };

    setWs(socket);
  }

  function create() {
    ws.send(JSON.stringify({ type: "CREATE" }));
  }

  function join() {
    ws.send(JSON.stringify({ type: "JOIN", code }));
  }

  function sendMsg() {
    ws.send(JSON.stringify({ type: "MSG", text: msg }));
    setMsg("");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>La Borsa (test multiplayer)</h1>

      {!ws && <button onClick={connect}>Connetti</button>}

      <div style={{ marginTop: 10 }}>
        <button onClick={create}>Crea lobby</button>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Room code"
        />
        <button onClick={join}>Entra</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Messaggio"
        />
        <button onClick={sendMsg}>Invia</button>
      </div>

      <div style={{ marginTop: 20 }}>
        {log.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>
    </div>
  );
}
