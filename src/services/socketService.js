import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

let io;

export function initSocket(server) {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication error: No token"));
    }
    try {
      const payload = jwt.verify(token, env.jwtSecret());
      socket.user = payload;
      next();
    } catch (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[socket] User connected: ${socket.user.userId || socket.user.id || socket.user._id}`);
    
    // Client should emit 'join_business' with the businessId they are viewing
    socket.on("join_business", (businessId, ack) => {
      if (!businessId) {
        if (typeof ack === "function") ack({ success: false, error: "Missing businessId" });
        return;
      }
      const room = `business_${businessId}`;
      socket.join(room);
      const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
      console.log(`[socket] Joining room for business: ${businessId} sockets=${roomSize}`);
      if (typeof ack === "function") ack({ success: true });
    });

    socket.on("leave_business", (businessId) => {
      const room = `business_${businessId}`;
      socket.leave(room);
      const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
      console.log(`[socket] Leaving room for business: ${businessId} sockets=${roomSize}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket] User disconnected`);
    });
  });
}

export function broadcastToBusiness(businessId, event, data) {
  if (!io) {
    console.warn(`[socket] Broadcast skipped before socket init event=${event} business=${businessId}`);
    return;
  }

  const room = `business_${businessId}`;
  const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
  const entityId = data?._id || data?.id || data?.conversationId || "";

  console.log(`[socket] Broadcasting ${event} business=${businessId} sockets=${roomSize} id=${entityId}`);
  io.to(room).emit(event, data);
}
