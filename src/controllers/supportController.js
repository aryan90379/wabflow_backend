import { SupportTicket, SupportMessage } from "../models/index.js";
import { broadcastToBusiness } from "../services/socketService.js";

// --- User (Business) Methods ---

export const createTicket = async (req, res) => {
  const { subject, description, attachments } = req.body;
  if (!subject) {
    return res.status(400).json({ error: "Subject is required" });
  }

  const ticket = await SupportTicket.create({
    businessId: req.business._id,
    createdBy: req.userId,
    subject,
    description,
    status: "open",
    priority: "normal",
  });

  if (description || (attachments && attachments.length > 0)) {
    await SupportMessage.create({
      ticketId: ticket._id,
      senderId: req.userId,
      senderRole: "user",
      message: description || "Attached files",
      attachments: attachments || [],
    });
  }

  res.status(201).json(ticket);
};

export const listTickets = async (req, res) => {
  const tickets = await SupportTicket.find({ businessId: req.business._id })
    .sort({ lastMessageAt: -1 })
    .populate("createdBy", "name email");

  res.json(tickets);
};

export const getTicket = async (req, res) => {
  const ticket = await SupportTicket.findOne({
    _id: req.params.ticketId,
    businessId: req.business._id,
  }).populate("createdBy", "name email");

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  if (ticket.hasUnreadUpdates) {
    ticket.hasUnreadUpdates = false;
    await ticket.save();
    broadcastToBusiness(ticket.businessId.toString(), "support_ticket_read", { ticketId: ticket._id });
  }

  res.json(ticket);
};

export const getMessages = async (req, res) => {
  const ticket = await SupportTicket.findOne({
    _id: req.params.ticketId,
    businessId: req.business._id,
  });

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const messages = await SupportMessage.find({ ticketId: ticket._id })
    .sort({ createdAt: 1 })
    .populate("senderId", "name email");

  if (ticket.hasUnreadUpdates) {
    ticket.hasUnreadUpdates = false;
    await ticket.save();
    broadcastToBusiness(ticket.businessId.toString(), "support_ticket_read", { ticketId: ticket._id });
  }

  res.json(messages);
};

export const sendMessage = async (req, res) => {
  const { message, attachments } = req.body;
  const ticket = await SupportTicket.findOne({
    _id: req.params.ticketId,
    businessId: req.business._id,
  });

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const supportMessage = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: req.userId,
    senderRole: "user",
    message: message || "Attached files",
    attachments: attachments || [],
  });

  ticket.lastMessageAt = new Date();
  await ticket.save();

  await supportMessage.populate("senderId", "name email");
  res.status(201).json(supportMessage);
};

export const getUnreadTicketStatus = async (req, res) => {
  const count = await SupportTicket.countDocuments({
    businessId: req.business._id,
    hasUnreadUpdates: true,
  });
  res.json({ hasUnread: count > 0 });
};

// --- Admin (Developer) Methods ---

export const adminListTickets = async (req, res) => {
  const tickets = await SupportTicket.find({})
    .sort({ lastMessageAt: -1 })
    .populate("businessId", "businessName")
    .populate("createdBy", "name email");

  res.json(tickets);
};

export const adminGetTicket = async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.ticketId)
    .populate("businessId", "businessName")
    .populate("createdBy", "name email");

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  res.json(ticket);
};

export const adminUpdateTicket = async (req, res) => {
  const { status, priority } = req.body;
  const ticket = await SupportTicket.findById(req.params.ticketId);

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  if (status) ticket.status = status;
  if (priority) ticket.priority = priority;

  ticket.hasUnreadUpdates = true;
  await ticket.save();
  broadcastToBusiness(ticket.businessId.toString(), "support_ticket_updated", { ticketId: ticket._id });

  res.json(ticket);
};

export const adminGetMessages = async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.ticketId);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const messages = await SupportMessage.find({ ticketId: ticket._id })
    .sort({ createdAt: 1 })
    .populate("senderId", "name email");

  res.json(messages);
};

export const adminSendMessage = async (req, res) => {
  const { message, attachments } = req.body;
  const ticket = await SupportTicket.findById(req.params.ticketId);

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const supportMessage = await SupportMessage.create({
    ticketId: ticket._id,
    senderId: req.userId,
    senderRole: "developer",
    message: message || "Attached files",
    attachments: attachments || [],
  });

  ticket.lastMessageAt = new Date();
  ticket.hasUnreadUpdates = true;
  await ticket.save();
  broadcastToBusiness(ticket.businessId.toString(), "support_ticket_updated", { ticketId: ticket._id });

  await supportMessage.populate("senderId", "name email");
  res.status(201).json(supportMessage);
};
