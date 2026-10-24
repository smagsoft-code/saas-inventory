import { PRODUCT_IMAGE_DIMENSIONS_TEXT } from '../lib/catalog/product-image-spec';

/** The size a product photo should have, printed right under the image frame. */
export function ProductImageDimensions({ className = 'mb-3' }: { className?: string }): React.JSX.Element {
  return <p className={`${className} text-center text-xs text-slate-500`}>Dimensiones: {PRODUCT_IMAGE_DIMENSIONS_TEXT}</p>;
}
