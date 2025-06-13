import express from "express";
import { register, login } from "../../controllers/v1/userController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);

export default router;