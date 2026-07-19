// STUB — replaced by the vitamins segment implementation.
import { Router } from "express";

export const vitaminsRouter = Router();

vitaminsRouter.use((_req, res) => {
  res.status(501).json({ error: "Vitamins routes not implemented yet" });
});
