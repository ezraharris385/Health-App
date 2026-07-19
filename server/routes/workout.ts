// STUB — replaced by the workout segment implementation.
import { Router } from "express";

export const workoutRouter = Router();

workoutRouter.use((_req, res) => {
  res.status(501).json({ error: "Workout routes not implemented yet" });
});
