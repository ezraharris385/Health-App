// STUB — replaced by the sleep segment implementation.
import { Router } from "express";

export const sleepRouter = Router();

sleepRouter.use((_req, res) => {
  res.status(501).json({ error: "Sleep routes not implemented yet" });
});
