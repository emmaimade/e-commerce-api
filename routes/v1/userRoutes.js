import express from "express";
import {
  getUser,
  updateUser
} from "../../controllers/v1/userController.js";
import { auth } from "../../middleware/auth.js";

const router = express.Router();

router.get("/profile", auth, getUser);
router.patch("/updateprofile", auth, updateUser);

export default router;
