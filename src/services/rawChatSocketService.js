import { WebSocket, WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { Business } from "../models/Business.js";
import { env } from "../config/env.js";

let wss;
const businessSockets = new Map();

const safeSend = (socket, payload) => {
  if (socket.readyState !== WebSocket.OPEN) return false;

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn("[raw-ws] send failed", error.message);
    return false;
  }
};

const addSocket = (businessId, socket) => {
  const key = String(businessId);
  const sockets = businessSockets.get(key) || new Set();
  sockets.add(socket);
  businessSockets.set(key, sockets);
  console.log(`[raw-ws] connected business=${key} sockets=${sockets.size}`);
};

const removeSocket = (businessId, socket) => {
  const key = String(businessId);
  const sockets = businessSockets.get(key);
  if (!sockets) return;

  sockets.delete(socket);
  if (sockets.size === 0) {
    businessSockets.delete(key);
  }

  console.log(`[raw-ws] disconnected business=${key} sockets=${sockets.size}`);
};

const authenticate = async (request, businessId) => {
  const url = new URL(request.url, "http://localhost");
  const token = url.searchParams.get("token") || "";

  if (!token) {
    throw new Error("No token");
  }

  const payload = jwt.verify(token, env.jwtSecret());
  const userId = payload.userId || payload.id || payload._id;

  if (!userId) {
    throw new Error("Invalid token payload");
  }

  const business = await Business.findOne({
    _id: businessId,
    ownerId: userId,
    active: true,
  }).select("_id");

  if (!business) {
    throw new Error("Business access denied");
  }

  return { userId, businessId: String(business._id) };
};

export function initRawChatSocket(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    const match = url.pathname.match(/^\/ws\/chat\/([^/]+)$/);

    if (!match) return;

    const businessId = match[1];

    authenticate(request, businessId)
      .then((auth) => {
        wss.handleUpgrade(request, socket, head, (websocket) => {
          websocket.businessId = auth.businessId;
          websocket.userId = auth.userId;
          websocket.isAlive = true;

          addSocket(auth.businessId, websocket);

          websocket.on("pong", () => {
            websocket.isAlive = true;
          });

          websocket.on("message", (raw) => {
            try {
              const parsed = JSON.parse(String(raw));
              if (parsed?.type === "ping") {
                safeSend(websocket, { type: "pong", ts: Date.now() });
              }
            } catch {
              // Ignore non-JSON client messages.
            }
          });

          websocket.on("close", () => removeSocket(auth.businessId, websocket));
          websocket.on("error", () => removeSocket(auth.businessId, websocket));

          safeSend(websocket, {
            type: "connected",
            businessId: auth.businessId,
            ts: Date.now(),
          });
        });
      })
      .catch((error) => {
        console.warn(`[raw-ws] rejected business=${businessId} error=${error.message}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  const heartbeat = setInterval(() => {
    for (const [businessId, sockets] of businessSockets.entries()) {
      for (const socket of Array.from(sockets)) {
        if (socket.isAlive === false) {
          socket.terminate();
          removeSocket(businessId, socket);
          continue;
        }

        socket.isAlive = false;
        socket.ping();
      }
    }
  }, 30000);

  wss.on("close", () => clearInterval(heartbeat));
}

export function broadcastRawToBusiness(businessId, event, data) {
  const key = String(businessId);
  const sockets = businessSockets.get(key);
  const payload = {
    type: event,
    event,
    data,
    ts: Date.now(),
  };

  if (!sockets || sockets.size === 0) {
    console.log(`[raw-ws] broadcast ${event} business=${key} sockets=0`);
    return 0;
  }

  let delivered = 0;
  for (const socket of Array.from(sockets)) {
    if (safeSend(socket, payload)) delivered += 1;
    else removeSocket(key, socket);
  }

  console.log(`[raw-ws] broadcast ${event} business=${key} sockets=${sockets.size} delivered=${delivered}`);
  return delivered;
}
