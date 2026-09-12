// Eventando Manager signup → EventSignup GraphQL type.
const mapSignup = (signup) => ({
  id: String(signup.documentId || signup.id),
  name: signup.name || '',
  email: signup.email || '',
  phone_number: signup.phone_number || '',
  checked_in: signup.checked_in || false,
  checked_in_at: signup.checked_in_at || null,
  product_name: signup.payment?.batch?.product?.name || null,
});

export default mapSignup;
