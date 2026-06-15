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
    socket.on("join_business", (businessId) => {
      console.log(`[socket] Joining room for business: ${businessId}`);
      socket.join(`business_${businessId}`);
    });

    socket.on("leave_business", (businessId) => {
      socket.leave(`business_${businessId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket] User disconnected`);
    });
  });
}

export function broadcastToBusiness(businessId, event, data) {
  if (!io) return;
  io.to(`business_${businessId}`).emit(event, data);
}
