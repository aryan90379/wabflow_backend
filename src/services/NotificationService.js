import { Notification } from "../models/Notification.js";
import { notificationQueue } from "../workers/notificationWorker.js";

class NotificationService {
  /**
   * Internal method to create a notification record and queue it.
   */
  async queueNotification({ businessId, recipientId, type, title, body, payload }) {
    try {
      const notification = await Notification.create({
        businessId,
        recipientId,
        type,
        title,
        body,
        payload,
      });

      // Add to BullMQ Queue
      await notificationQueue.add(
        type,
        { notificationId: notification._id },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
          removeOnComplete: true, // Keep redis clean
          removeOnFail: false,    // Keep failed jobs for inspection
        }
      );

      return notification;
    } catch (error) {
      console.error("[NotificationService] Error queuing notification:", error);
      throw error;
    }
  }

  async sendNewChatNotification(businessId, recipientId, chatId, contactName) {
    return this.queueNotification({
      businessId,
      recipientId,
      type: "NEW_CHAT",
      title: "New Incoming Chat",
      body: `You have a new message from ${contactName}`,
      payload: { chatId },
    });
  }

  async sendNewLeadNotification(businessId, recipientId, leadId, leadName) {
    return this.queueNotification({
      businessId,
      recipientId,
      type: "NEW_LEAD",
      title: "New Lead Created",
      body: `${leadName} has been added as a new lead.`,
      payload: { leadId },
    });
  }

  async sendNewBookingNotification(businessId, recipientId, bookingId, bookingDetails) {
    return this.queueNotification({
      businessId,
      recipientId,
      type: "NEW_BOOKING",
      title: "New Booking Received",
      body: `You have a new booking for ${bookingDetails}`,
      payload: { bookingId },
    });
  }
}

export const notificationService = new NotificationService();
