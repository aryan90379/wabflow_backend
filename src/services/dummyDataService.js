import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Business } from "../models/Business.js";
import { BusinessMember } from "../models/BusinessMember.js";
import { Contact } from "../models/Contact.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Booking } from "../models/Booking.js";
import { Lead } from "../models/Lead.js";
import { FollowUpTask } from "../models/FollowUpTask.js";
import { WhatsappAccount } from "../models/WhatsappAccount.js";
import { WhatsappMessageTemplate } from "../models/WhatsappMessageTemplate.js";
import { ListGroup } from "../models/ListGroup.js";
import { ListItem } from "../models/ListItem.js";
import { ServiceItem } from "../models/ServiceItem.js";
import { AutomationFlow } from "../models/AutomationFlow.js";
import { BotKnowledge } from "../models/BotKnowledge.js";

const DUMMY_IMAGE = "https://images.unsplash.com/photo-1491378630646-3440efa57c3b?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1yZWxhdGVkfDE4fHx8ZW58MHx8fHx8";

export async function generateDummyData(user) {
  try {
    console.log("Generating dummy data for user:", user._id);

    // 1. Get or create the business
    let business = await Business.findOne({ ownerId: user._id });
    if (!business) {
      business = await Business.create({
        ownerId: user._id,
        name: "Premium Spa & Salon",
        timezone: "Asia/Kolkata",
        currency: "INR",
        active: true,
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      console.log("Created demo business:", business._id);
    } else {
      // Clean slate - wipe existing dummy data for this business
      await Promise.all([
        Contact.deleteMany({ businessId: business._id }),
        Conversation.deleteMany({ businessId: business._id }),
        Message.deleteMany({ businessId: business._id }),
        Booking.deleteMany({ businessId: business._id }),
        Lead.deleteMany({ businessId: business._id }),
        Booking.deleteMany({ businessId: business._id }),
        FollowUpTask.deleteMany({ businessId: business._id }),
        WhatsappAccount.deleteMany({ businessId: business._id }),
        WhatsappMessageTemplate.deleteMany({ businessId: business._id }),
        ListGroup.deleteMany({ businessId: business._id }),
        ListItem.deleteMany({ businessId: business._id }),
        ServiceItem.deleteMany({ businessId: business._id }),
        AutomationFlow.deleteMany({ businessId: business._id }),
        BotKnowledge.deleteMany({ businessId: business._id }),
      ]);
      console.log("Wiped existing dummy data for business:", business._id);
    }

    // Ensure member exists
    let member = await BusinessMember.findOne({ businessId: business._id, userId: user._id });
    if (!member) {
      member = await BusinessMember.create({
        businessId: business._id,
        userId: user._id,
        memberType: "owner",
        role: "owner",
        status: "active",
        name: user.name || "Apple Reviewer",
      });
    }

    // 2. Generate WhatsApp Account
    const uniqueSuffix = business._id.toString().slice(-10);
    const waAccount = await WhatsappAccount.create({
      businessId: business._id,
      wabaId: `12345${uniqueSuffix}`,
      phoneNumberId: `98765${uniqueSuffix}`,
      displayPhoneNumber: "+1 555-0100",
      verifiedName: "Premium Spa & Salon",
      profileDisplayName: "Premium Spa & Salon",
      status: "active",
      hasPaymentMethod: true,
      hasPaymentMethodCheckedAt: new Date(),
      encryptedValue: "dummy_encrypted_value",
      encryptionIv: "dummy_iv",
      encryptionTag: "dummy_tag",
      tokenType: "system_user",
    });

    // 3. Generate Contacts
    const contactsData = [
      { name: "John Doe", phone: "+15550101", notes: "VIP Client" },
      { name: "Alice Smith", phone: "+15550102", notes: "Prefers evening appointments" },
      { name: "Bob Johnson", phone: "+15550103" },
      { name: "Emma Davis", phone: "+15550104" },
      { name: "Michael Brown", phone: "+15550105" },
    ];

    const contacts = await Contact.insertMany(
      contactsData.map(c => ({
        ...c,
        waId: c.phone.replace("+", ""),
        businessId: business._id,
        profilePic: DUMMY_IMAGE,
        status: "active",
        optedIn: true,
      }))
    );

    // 4. Generate ListGroup and ListItems (Catalog)
    const listGroup = await ListGroup.create({
      businessId: business._id,
      name: "Spa Services",
      active: true,
    });

    const listItems = await ListItem.insertMany([
      { listGroupId: listGroup._id, businessId: business._id, title: "Deep Tissue Massage", price: 2500, details: "60 mins of deep relaxation.", imageUrl: DUMMY_IMAGE, active: true },
      { listGroupId: listGroup._id, businessId: business._id, title: "Premium Haircut", price: 800, details: "Includes wash and styling.", imageUrl: DUMMY_IMAGE, active: true },
      { listGroupId: listGroup._id, businessId: business._id, title: "Facial Treatment", price: 1500, details: "Rejuvenating facial therapy.", imageUrl: DUMMY_IMAGE, active: true },
    ]);


    // 5. Generate Dates
    const now = new Date();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(14, 0, 0, 0);
    const dayAfter = new Date(now); dayAfter.setDate(dayAfter.getDate() + 2); dayAfter.setHours(10, 30, 0, 0);
    const lastWeek = new Date(now); lastWeek.setDate(lastWeek.getDate() - 7); lastWeek.setHours(15, 0, 0, 0);

    // 6. Generate Templates
    await WhatsappMessageTemplate.insertMany([
      {
        businessId: business._id,
        whatsappAccountId: waAccount._id,
        wabaId: waAccount.wabaId,
        name: "appointment_reminder",
        displayName: "Appointment Reminder",
        category: "UTILITY",
        language: "en_US",
        status: "approved",
        body: "Hi {{1}}, your appointment is coming up on {{2}}. See you soon!",
      },
      {
        businessId: business._id,
        whatsappAccountId: waAccount._id,
        wabaId: waAccount.wabaId,
        name: "welcome_message",
        displayName: "Welcome Message",
        category: "MARKETING",
        language: "en_US",
        status: "approved",
        headerType: "IMAGE",
        headerImageUrl: DUMMY_IMAGE,
        body: "Welcome to Premium Spa & Salon! Enjoy 10% off your first visit.",
      }
    ]);

    // 7. Generate Conversations and Messages
    const conv1 = await Conversation.create({
      businessId: business._id,
      contactId: contacts[0]._id,
      whatsappAccountId: waAccount._id,
      contactPhone: contacts[0].phone,
      status: "open",
      lastMessageAt: new Date(now.getTime() - 5000),
      lastMessagePreview: "Sure, see you tomorrow!",
    });
    
    await Message.insertMany([
      {
        businessId: business._id,
        conversationId: conv1._id,
        contactId: contacts[0]._id,
        whatsappAccountId: waAccount._id,
        direction: "outbound",
        senderType: "owner",
        status: "read",
        type: "text",
        text: "Hi John, confirming your appointment for tomorrow.",
        createdAt: new Date(now.getTime() - 60000),
        serverSequence: 1,
        clientMessageId: "msg_1",
      },
      {
        businessId: business._id,
        conversationId: conv1._id,
        contactId: contacts[0]._id,
        whatsappAccountId: waAccount._id,
        direction: "inbound",
        senderType: "customer",
        status: "received",
        type: "text",
        text: "Sure, see you tomorrow!",
        createdAt: new Date(now.getTime() - 5000),
        serverSequence: 2,
        clientMessageId: "msg_2",
      }
    ]);

    const conv2 = await Conversation.create({
      businessId: business._id,
      contactId: contacts[1]._id,
      whatsappAccountId: waAccount._id,
      contactPhone: contacts[1].phone,
      status: "open",
      lastMessageAt: new Date(now.getTime() - 3600000),
      lastMessagePreview: "What are your prices?",
    });

    await Message.insertMany([
      {
        businessId: business._id,
        conversationId: conv2._id,
        contactId: contacts[1]._id,
        whatsappAccountId: waAccount._id,
        direction: "inbound",
        senderType: "customer",
        status: "received",
        type: "text",
        text: "What are your prices?",
        createdAt: new Date(now.getTime() - 3600000),
        serverSequence: 1,
        clientMessageId: "msg_3",
      }
    ]);

    // 8. Generate Leads (Inquiries)
    await Lead.insertMany([
      {
        businessId: business._id,
        contactId: contacts[0]._id,
        conversationId: conv1._id,
        source: "whatsapp",
        intent: "enquiry",
        score: 85,
        status: "new",
        requirement: "Looking for a couple's spa package.",
        budget: "2500",
        preferredDate: tomorrow.toISOString().split("T")[0],
        preferredTime: "Evening",
        city: "San Francisco",
        updatedByMemberId: member._id,
        updatedByName: member.name,
      },
      {
        businessId: business._id,
        contactId: contacts[1]._id,
        conversationId: conv2._id,
        source: "whatsapp",
        intent: "pricing",
        score: 40,
        status: "contacted",
        requirement: "Wants to know haircut prices.",
        budget: null,
      }
    ]);

    // 9. Generate Bookings
    await Booking.insertMany([
      {
        businessId: business._id,
        contactId: contacts[0]._id,
        conversationId: conv1._id,
        type: "appointment",
        status: "confirmed",
        startDate: tomorrow.toISOString().split("T")[0],
        startTime: "10:00",
        endTime: "11:30",
        guests: 1,
        customerName: contacts[0].name,
        customerPhone: contacts[0].phone,
        notes: "Requested deep tissue massage.",
        updatedByMemberId: member._id,
        updatedByName: member.name,
      },
      {
        businessId: business._id,
        contactId: contacts[1]._id,
        conversationId: conv2._id,
        type: "appointment",
        status: "requested",
        startDate: new Date(Date.now() + 86400000 * 3).toISOString().split("T")[0],
        startTime: "14:00",
        endTime: "15:00",
        guests: 1,
        customerName: contacts[1].name,
        customerPhone: contacts[1].phone,
        notes: "Haircut and styling.",
        updatedByMemberId: member._id,
        updatedByName: member.name,
      }
    ]);

    // 9. Generate BotKnowledge (FAQ)
    await BotKnowledge.insertMany([
      {
        businessId: business._id,
        category: "pricing",
        question: "How much is a deep tissue massage?",
        answer: "Our Deep Tissue Massage is $25 for 60 minutes of deep relaxation.",
        keywords: ["massage", "price", "deep tissue", "cost"],
        active: true,
      },
      {
        businessId: business._id,
        category: "timing",
        question: "What are your opening hours?",
        answer: "We are open Monday to Saturday from 9 AM to 8 PM, and Sunday from 10 AM to 6 PM.",
        keywords: ["hours", "open", "timing", "close"],
        active: true,
      }
    ]);

    // 10. Generate AutomationFlow (Bot)
    await AutomationFlow.create({
      businessId: business._id,
      whatsappAccountId: waAccount._id,
      name: "Welcome & Booking Bot",
      description: "Automatically greets customers and offers service menus.",
      status: "published",
      isDefault: true,
      version: 1,
      trigger: {
        type: "any_message",
        matchMode: "any",
      },
      startNodeId: "node_1",
      nodes: [
        {
          nodeId: "node_1",
          type: "message",
          name: "Welcome Message",
          response: {
            type: "buttons",
            text: "Hi there! Welcome to Premium Spa & Salon. How can we help you today?",
            buttonText: "View options",
            options: [
              { id: "opt_1", title: "View Services", nextNodeId: "node_2" },
              { id: "opt_2", title: "Opening Hours", nextNodeId: "node_3" }
            ]
          },
          nextNodeId: "",
        },
        {
          nodeId: "node_2",
          type: "message",
          name: "Services Menu",
          response: {
            type: "text",
            text: "We offer Haircuts, Massages, and Facials. Let me know what you'd like to book!",
          },
          nextNodeId: "",
        },
        {
          nodeId: "node_3",
          type: "message",
          name: "Hours Info",
          response: {
            type: "text",
            text: "We are open 9 AM to 8 PM daily.",
          },
          nextNodeId: "",
        }
      ],
      publishedAt: new Date(),
    });

    console.log("Successfully generated all dummy data for Apple Reviewer.");
  } catch (error) {
    console.error("Error generating dummy data:", error);
  }
}
