import * as userService from "../../services/userService.js";

export const adminGetUsers = async (req, res) => {
  const users = await userService.listUsers();

  res.status(200).json({ users });
};

export const adminGetUser = async (req, res) => {
  const user = await userService.getUser(req.params.id);

  res.status(200).json({ user });
};
