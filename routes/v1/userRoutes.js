import express from "express";
import {
  getUser,
  updateUser
} from "../../controllers/v1/userController.js";
import { auth } from "../../middleware/auth.js";

import { validate } from "../../middleware/validate.js";
import { updateProfileSchema } from "../../utils/schemas.js";

const router = express.Router();

router.get("/profile", auth, getUser);
router.patch("/updateprofile", auth, validate({ body: updateProfileSchema }), updateUser);

export default router;
