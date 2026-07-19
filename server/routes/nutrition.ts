// STUB — replaced by the nutrition segment implementation.
import { Router } from "express";

export const nutritionRouter = Router();

nutritionRouter.use((_req, res) => {
  res.status(501).json({ error: "Nutrition routes not implemented yet" });
});
