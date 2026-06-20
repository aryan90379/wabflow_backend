import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { redirectPublicQrShortLink } from "../controllers/qrShortLinkController.js";

const router = Router();

router.get("/:slug", asyncHandler(redirectPublicQrShortLink));

export default router;
