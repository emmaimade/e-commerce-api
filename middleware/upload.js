import multer from "multer";

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    // check if file is an image
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("File must be an image"), false);
    }
}

export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 5 // 5MB limit
    },
    fileFilter: fileFilter,
});