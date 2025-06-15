import express from "express";
import {
  getUsers,
  getUser,
  register,
  login,
  updateUser,
} from "../../controllers/v1/userController.js";
import auth from "../../middleware/auth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/admin/users", auth, getUsers);
router.get("/admin/users/:id", auth, getUser);
router.patch("/update", auth, updateUser);

export default router;
