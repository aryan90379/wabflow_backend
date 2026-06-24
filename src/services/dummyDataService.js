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
    let waAccount = await WhatsappAccount.findOne({ businessId: business._id });
    if (!waAccount) {
      waAccount = await WhatsappAccount.create({
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
    }

    // 2.5 Generate QR Short Link
    const QrShortLink = mongoose.models.QrShortLink || mongoose.model("QrShortLink");
    let qrLink = await QrShortLink.findOne({ businessId: business._id });
    if (!qrLink) {
      qrLink = await QrShortLink.create({
        businessId: business._id,
        whatsappAccountId: waAccount._id,
        slug: `spa${uniqueSuffix.slice(-4)}`,
        title: "Premium Spa & Salon Bot QR",
        phoneNumber: "15550100",
        starterMessage: "Hi, I would like to know more.",
        active: true,
      });
    }

    // 3. Generate Dense Contacts (15+ Contacts)
    const firstNames = ["John", "Alice", "Bob", "Emma", "Michael", "Sarah", "David", "Laura", "James", "Sophia", "Oliver", "Isabella", "William", "Mia", "Lucas", "Charlotte"];
    const lastNames = ["Doe", "Smith", "Johnson", "Davis", "Brown", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson"];
    
    const contactsData = [];
    for (let i = 0; i < 15; i++) {
      contactsData.push({
        name: `${firstNames[i]} ${lastNames[i]}`,
        phone: `+155501${i.toString().padStart(2, '0')}`,
        notes: i % 3 === 0 ? "VIP Client" : i % 5 === 0 ? "Prefers evening appointments" : "",
        waId: `155501${i.toString().padStart(2, '0')}`,
        businessId: business._id,
        profilePic: DUMMY_IMAGE,
        status: "active",
        optedIn: true,
      });
    }

    const contacts = await Contact.insertMany(contactsData);

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
      { listGroupId: listGroup._id, businessId: business._id, title: "Manicure & Pedicure", price: 1200, details: "Complete nail care.", imageUrl: DUMMY_IMAGE, active: true },
      { listGroupId: listGroup._id, businessId: business._id, title: "Hot Stone Therapy", price: 3000, details: "Ultimate relaxation.", imageUrl: DUMMY_IMAGE, active: true },
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

    // 7. Generate Conversations, Messages, Leads, and Bookings for each contact
    const conversationsToInsert = [];
    for (let i = 0; i < 15; i++) {
      conversationsToInsert.push({
        businessId: business._id,
        contactId: contacts[i]._id,
        whatsappAccountId: waAccount._id,
        contactPhone: contacts[i].phone,
        status: i % 4 === 0 ? "closed" : "open",
        lastMessageAt: new Date(now.getTime() - Math.random() * 86400000 * 3), // random within last 3 days
        lastMessagePreview: `Message from ${contacts[i].name}`,
      });
    }
    const convs = await Conversation.insertMany(conversationsToInsert);

    const messagesToInsert = [];
    const leadsToInsert = [];
    const bookingsToInsert = [];

    for (let i = 0; i < 15; i++) {
      const conv = convs[i];
      const contact = contacts[i];
      
      // Add 3-5 messages per conversation
      const numMessages = 3 + (i % 3);
      for (let j = 0; j < numMessages; j++) {
        const isCustomer = j % 2 === 0;
        messagesToInsert.push({
          businessId: business._id,
          conversationId: conv._id,
          contactId: contact._id,
          whatsappAccountId: waAccount._id,
          direction: isCustomer ? "inbound" : "outbound",
          senderType: isCustomer ? "customer" : "owner",
          status: isCustomer ? "received" : "read",
          type: "text",
          text: isCustomer ? `I would like to know more about your services.` : `Hi ${contact.name}! We'd love to help you.`,
          createdAt: new Date(conv.lastMessageAt.getTime() - ((numMessages - j) * 60000)),
          serverSequence: j + 1,
          clientMessageId: `msg_${i}_${j}`,
        });
      }

      // Add leads for half of them
      if (i % 2 === 0) {
        leadsToInsert.push({
          businessId: business._id,
          contactId: contact._id,
          conversationId: conv._id,
          source: "whatsapp",
          intent: i % 3 === 0 ? "pricing" : "enquiry",
          score: 40 + (i * 3),
          status: i % 4 === 0 ? "booked" : i % 3 === 0 ? "contacted" : "new",
          requirement: `Interested in a ${i % 2 === 0 ? 'massage' : 'haircut'}.`,
          budget: `${1500 + i * 100}`,
          preferredDate: new Date(now.getTime() + 86400000 * (i % 5)).toISOString().split("T")[0],
          preferredTime: i % 2 === 0 ? "Evening" : "Morning",
          city: "San Francisco",
          updatedByMemberId: member._id,
          updatedByName: member.name,
        });
      }

      // Add bookings for a third of them
      if (i % 3 === 0) {
        const d = new Date(now.getTime() + 86400000 * (i % 7));
        bookingsToInsert.push({
          businessId: business._id,
          contactId: contact._id,
          conversationId: conv._id,
          type: "appointment",
          status: i === 0 ? "confirmed" : i % 6 === 0 ? "completed" : "requested",
          startDate: d.toISOString().split("T")[0],
          startTime: `${10 + (i % 8)}:00`,
          endTime: `${11 + (i % 8)}:30`,
          guests: 1,
          customerName: contact.name,
          customerPhone: contact.phone,
          notes: `Booking for ${contact.name}.`,
          updatedByMemberId: member._id,
          updatedByName: member.name,
        });
      }
    }

    await Message.insertMany(messagesToInsert);
    await Lead.insertMany(leadsToInsert);
    await Booking.insertMany(bookingsToInsert);

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
      name: "Premium Spa & Salon Bot",
      description: "Automatically greets customers and offers service menus.",
      status: "published",
      isDefault: true,
      version: 2,
      trigger: {
        type: "any_message",
        matchMode: "any",
      },
      entryStepId: "step_1",
      steps: [
        {
          id: "step_1",
          type: "message",
          name: "Welcome Message",
          config: {
            messageType: "buttons",
            text: "Hey! Welcome to Premium Spa & Salon. How can we help you today?\n\n(write hi to reset the flow)",
            buttons: [
              {
                id: "btn_1",
                label: "View Services",
                value: "View Services",
                action: { type: "go_to_step", targetStepId: "step_2" }
              },
              {
                id: "btn_2",
                label: "Opening Hours",
                value: "Opening Hours",
                action: { type: "go_to_step", targetStepId: "step_3" }
              }
            ]
          }
        },
        {
          id: "step_2",
          type: "message",
          name: "Services Menu",
          config: {
            messageType: "text",
            text: "We offer Haircuts, Massages, and Facials. Let me know what you'd like to book!",
            buttons: []
          }
        },
        {
          id: "step_3",
          type: "message",
          name: "Hours Info",
          config: {
            messageType: "text",
            text: "We are open 9 AM to 8 PM daily.",
            buttons: []
          }
        }
      ],
      publishedAt: new Date(),
    });

    console.log("Successfully generated all dummy data for Apple Reviewer.");
  } catch (error) {
    console.error("Error generating dummy data:", error);
  }
}

