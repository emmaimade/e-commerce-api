import express from 'express';
import {
  getUserShippingAddresses,
  getShippingAddress,
  addShippingAddress,
  updateShippingAddress,
  deleteShippingAddress,
} from "../../controllers/v1/shippingController.js";
import { auth } from '../../middleware/auth.js';

const router = express.Router();

router.get('/', auth, getUserShippingAddresses);
router.get('/:id', auth, getShippingAddress);
router.post('/', auth, addShippingAddress);
router.patch('/:id', auth, updateShippingAddress);
router.delete('/:id', auth, deleteShippingAddress);

export default router;