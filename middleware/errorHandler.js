import multer from "multer";

export const handleUploadErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size 5MB.'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Too many files. Maximum is 5 files'
            });
        }
        if (err.message === 'Only image files are allowed!') {
            return res.status(400).json({
                success: false,
                message: 'Only image files are allowed!'
            });
        }
    }

    next(err);
};