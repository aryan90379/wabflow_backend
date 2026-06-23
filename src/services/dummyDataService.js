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
        FollowUpTask.deleteMany({ businessId: business._id }),
        WhatsappAccount.deleteMany({ businessId: business._id }),
        WhatsappMessageTemplate.deleteMany({ businessId: business._id }),
        ListGroup.deleteMany({ businessId: business._id }),
        ListItem.deleteMany({ businessId: business._id }),
        ServiceItem.deleteMany({ businessId: business._id }),
      ]);
      console.log("Wiped existing dummy data for business:", business._id);
    }

    // Ensure member exists
    let member = await BusinessMember.findOne({ businessId: business._id, userId: user._id });
    if (!member) {
      member = await BusinessMember.create({
        businessId: business._id,
        userId: user._id,
        role: "owner",
        status: "active",
        name: user.name || "Apple Reviewer",
      });
    }

    // 2. Generate WhatsApp Account
    const waAccount = await WhatsappAccount.create({
      businessId: business._id,
      wabaId: "123456789012345",
      phoneNumberId: "987654321098765",
      displayPhoneNumber: "+1 555-0100",
      verifiedName: "Premium Spa & Salon",
      qualityRating: "GREEN",
      status: "CONNECTED",
      messagingLimit: "1K",
      hasPaymentMethod: true,
      hasPaymentMethodCheckedAt: new Date(),
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
      status: "active",
    });

    const listItems = await ListItem.insertMany([
      { listGroupId: listGroup._id, businessId: business._id, name: "Deep Tissue Massage", price: 2500, description: "60 mins of deep relaxation.", imageUrl: DUMMY_IMAGE, isActive: true, position: 0 },
      { listGroupId: listGroup._id, businessId: business._id, name: "Premium Haircut", price: 800, description: "Includes wash and styling.", imageUrl: DUMMY_IMAGE, isActive: true, position: 1 },
      { listGroupId: listGroup._id, businessId: business._id, name: "Facial Treatment", price: 1500, description: "Rejuvenating facial therapy.", imageUrl: DUMMY_IMAGE, isActive: true, position: 2 },
    ]);

    // 5. Generate Bookings
    const now = new Date();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(14, 0, 0, 0);
    const dayAfter = new Date(now); dayAfter.setDate(dayAfter.getDate() + 2); dayAfter.setHours(10, 30, 0, 0);
    const lastWeek = new Date(now); lastWeek.setDate(lastWeek.getDate() - 7); lastWeek.setHours(15, 0, 0, 0);

    await Booking.insertMany([
      {
        businessId: business._id,
        contactId: contacts[0]._id,
        title: "Deep Tissue Massage",
        startTime: tomorrow,
        endTime: new Date(tomorrow.getTime() + 60 * 60000),
        status: "confirmed",
        reminderSent: false,
        price: 2500,
        notes: "Requested extra pressure.",
      },
      {
        businessId: business._id,
        contactId: contacts[1]._id,
        title: "Premium Haircut",
        startTime: dayAfter,
        endTime: new Date(dayAfter.getTime() + 45 * 60000),
        status: "pending",
        reminderSent: false,
        price: 800,
      },
      {
        businessId: business._id,
        contactId: contacts[2]._id,
        title: "Facial Treatment",
        startTime: lastWeek,
        endTime: new Date(lastWeek.getTime() + 60 * 60000),
        status: "completed",
        reminderSent: true,
        price: 1500,
      }
    ]);

    // 6. Generate Templates
    await WhatsappMessageTemplate.insertMany([
      {
        businessId: business._id,
        name: "appointment_reminder",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        components: [
          { type: "BODY", text: "Hi {{1}}, your appointment is coming up on {{2}}. See you soon!" }
        ]
      },
      {
        businessId: business._id,
        name: "welcome_message",
        category: "MARKETING",
        language: "en",
        status: "APPROVED",
        components: [
          { type: "HEADER", format: "IMAGE", example: { header_handle: [DUMMY_IMAGE] } },
          { type: "BODY", text: "Welcome to Premium Spa & Salon! Enjoy 10% off your first visit." }
        ]
      }
    ]);

    // 7. Generate Conversations and Messages
    const conv1 = await Conversation.create({
      businessId: business._id,
      contactId: contacts[0]._id,
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
        direction: "outbound",
        status: "read",
        type: "text",
        text: "Hi John, confirming your appointment for tomorrow.",
        createdAt: new Date(now.getTime() - 60000),
      },
      {
        businessId: business._id,
        conversationId: conv1._id,
        contactId: contacts[0]._id,
        direction: "inbound",
        status: "received",
        type: "text",
        text: "Sure, see you tomorrow!",
        createdAt: new Date(now.getTime() - 5000),
      }
    ]);

    const conv2 = await Conversation.create({
      businessId: business._id,
      contactId: contacts[1]._id,
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
        direction: "inbound",
        status: "received",
        type: "text",
        text: "What are your prices?",
        createdAt: new Date(now.getTime() - 3600000),
      }
    ]);

    console.log("Successfully generated all dummy data for Apple Reviewer.");
  } catch (error) {
    console.error("Error generating dummy data:", error);
  }
}
