/**
 * What a product photo should look like. The frame that shows it is square and the picture is
 * fitted with `object-contain` (never cropped), so any proportion works — it just shows margins
 * unless it is square. Format and size limits are the backend's own (`PRODUCT_IMAGE_MAX_BYTES`).
 */
export const PRODUCT_IMAGE_WIDTH_PX = 800;
export const PRODUCT_IMAGE_HEIGHT_PX = 800;

export const PRODUCT_IMAGE_DIMENSIONS_TEXT = `${PRODUCT_IMAGE_WIDTH_PX}x${PRODUCT_IMAGE_HEIGHT_PX} px`;
