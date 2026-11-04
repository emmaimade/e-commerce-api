import * as userService from "../../services/userService.js";

export const getUser = async (req, res) => {
  const user = await userService.getUser(req.user.id);

  res.status(200).json({
    success: true,
    message: "User retrieved successfully",
    user,
  });
};

export const updateUser = async (req, res) => {
  const user = await userService.updateProfile(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    user,
  });
};
