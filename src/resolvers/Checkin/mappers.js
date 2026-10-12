// Paid half price (meia-entrada, declared at signup): the Eventando applied the student
// discount to the payment. A coupon that gave more discount wins, so it is not half
// price; neither is a free batch (half of zero).
export const halfPriceOf = (signup) => {
  const payment = signup?.payment;
  if (payment?.discount_kind !== 'student') return false;
  return Number(payment.original_value ?? payment.value ?? 0) > 0;
};

// Eventando Manager signup → EventSignup GraphQL type.
const mapSignup = (signup) => ({
  id: String(signup.documentId || signup.id),
  name: signup.name || '',
  email: signup.email || '',
  phone_number: signup.phone_number || '',
  checked_in: signup.checked_in || false,
  checked_in_at: signup.checked_in_at || null,
  product_name: signup.payment?.batch?.product?.name || null,
  half_price: halfPriceOf(signup),
});

export default mapSignup;
