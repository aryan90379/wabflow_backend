import dotenv from "dotenv";
import { sendTextMessage, sendInteractiveButtons, sendInteractiveList } from '../services/whatsappClient.js';

dotenv.config();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// In-memory state
const userState = {};
const processedMessageIds = new Set();

// 🔥 STATIC CONFIG (replace if needed)
const CLINIC_NAME = "Dentflow Clinic";
const ADDRESS = "Your clinic address here";
const MAP_URL = "";

export const verifyWebhook = (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
};

export const receiveWebhook = async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;

    if (processedMessageIds.has(message.id)) return;
    processedMessageIds.add(message.id);

    const from = message.from;
    const type = message.type;

    let userInput =
      type === 'text'
        ? message.text.body.trim()
        : type === 'interactive'
        ? message.interactive.button_reply?.id ||
          message.interactive.list_reply?.id
        : '';

    if (!userState[from]) userState[from] = { step: 'idle' };
    const state = userState[from];

    // ===============================
    // MAIN MENU
    // ===============================
    const sendMainMenu = async (msg = null) => {
      state.step = 'idle';

      const text =
        msg ||
        `Hi 👋 Welcome to ${CLINIC_NAME}.\n\nHow can we help you today?`;

      await sendInteractiveButtons(from, text, [
        { reply: { id: 'menu_book', title: '📅 Book Appointment' } },
        { reply: { id: 'menu_treatments', title: '🦷 Treatments' } },
        { reply: { id: 'menu_map', title: '📍 Location' } },
      ]);
    };

    const normalized = userInput?.toLowerCase();

    // ===============================
    // GLOBAL RESET
    // ===============================
    if (
      userInput === 'main_menu' ||
      ['hi', 'hello', 'hey', 'menu', 'reset', 'cancel'].includes(normalized)
    ) {
      await sendMainMenu();
      return;
    }

    // ===============================
    // TEXT INPUT HANDLING
    // ===============================
    if (type === 'text') {
      if (state.step === 'wait_name') {
        state.name = userInput;
        state.step = 'wait_age';
        await sendTextMessage(from, `Got it. What is ${state.name}'s age?`);
        return;
      }

      if (state.step === 'wait_age') {
        state.age = userInput;
        state.step = 'confirmed';

        await sendTextMessage(
          from,
          `✅ Appointment Confirmed!\n\n${state.name} (${state.age}) is booked for ${state.day} at ${state.time} at ${CLINIC_NAME}.`
        );

        state.step = 'idle';
        return;
      }
    }

    // ===============================
    // ROUTING
    // ===============================
    switch (userInput) {
      case 'menu_map':
        await sendTextMessage(
          from,
          `📍 *Our Location:*\n${ADDRESS}\n\n${MAP_URL}`
        );
        await sendMainMenu();
        break;

      case 'menu_treatments':
        await sendInteractiveButtons(
          from,
          `🦷 Treatments we offer:\n\n• General Consultation\n• Cleaning\n• Whitening\n\nWant to book?`,
          [
            { reply: { id: 'menu_book', title: '📅 Book' } },
            { reply: { id: 'menu_map', title: '📍 Location' } },
          ]
        );
        break;

      case 'menu_book':
      case 'change_day':
        state.step = 'select_day';

        await sendInteractiveList(
          from,
          "Select a day:",
          "Choose Day",
          [
            {
              title: "Days",
              rows: [
                { id: 'day_Monday', title: 'Monday' },
                { id: 'day_Tuesday', title: 'Tuesday' },
                { id: 'day_Wednesday', title: 'Wednesday' },
                { id: 'day_Thursday', title: 'Thursday' },
                { id: 'day_Friday', title: 'Friday' },
              ],
            },
          ]
        );
        break;

      case 'day_Monday':
      case 'day_Tuesday':
      case 'day_Wednesday':
      case 'day_Thursday':
      case 'day_Friday':
        state.day = userInput.split('_')[1];
        state.step = 'select_time';

        await sendInteractiveList(
          from,
          `Selected ${state.day}. Choose time:`,
          "Choose Time",
          [
            {
              title: "Slots",
              rows: [
                { id: 'time_10:00 AM', title: '10:00 AM' },
                { id: 'time_11:30 AM', title: '11:30 AM' },
                { id: 'time_2:00 PM', title: '2:00 PM' },
              ],
            },
          ]
        );
        break;

      case 'time_10:00 AM':
      case 'time_11:30 AM':
      case 'time_2:00 PM':
        state.time = userInput.split('_')[1];
        state.step = 'wait_name';

        await sendTextMessage(
          from,
          `Great! ${state.day} at ${state.time}.\n\nPlease enter patient name:`
        );
        break;

      default:
        if (state.step === 'idle') {
          await sendMainMenu();
        } else {
          await sendTextMessage(from, "Please follow the menu 👇");
          await sendMainMenu();
        }
        break;
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
};