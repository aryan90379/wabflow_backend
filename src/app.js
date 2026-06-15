import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { apiRouter } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import metaRoutes from "./routes/metaRoutes.js";
export const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(
  express.json({
    limit: "12mb",
    verify: (req, res, buffer) => {
      if (req.originalUrl.includes("/webhooks/whatsapp")) {
        req.rawBody = Buffer.from(buffer);
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use("/api/meta", metaRoutes);
app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
