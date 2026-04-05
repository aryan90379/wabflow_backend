import express from 'express';
import { getAppointments, createAppointment, getAppointmentDetails } from '../controllers/appointmentController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authMiddleware, getAppointments);
router.post('/', authMiddleware, createAppointment);
router.get('/:id', authMiddleware, getAppointmentDetails); // 👈 ADD THIS ROUTE
export default router;