import {
  FaFacebook,
  FaGithub,
  FaInstagram,
  FaLinkedin,
  FaXRay,
} from "react-icons/fa";

export const socialLinks = [
  {
    icon: FaGithub,
    href: "https://TrustKinspection.com",
    label: "GitHub",
  },
  {
    icon: FaLinkedin,
    href: "https://TrustKinspection.com",
    label: "LinkedIn",
  },
  {
    icon: FaFacebook,
    href: "https://TrustKinspection.com",
    label: "Facebook",
  },
  {
    icon: FaInstagram,
    href: "https://TrustKinspection.com",
    label: "Instagram",
  },
  { icon: FaXRay, href: "https://TrustKinspection.com", label: "Twitter" },
];

export const pricing = [
  {
    id: "10201",
    plan: "Our Plan",
    price: "$0.10",
    features: [
      "1 Vehicle Report",
      "Vehicle Specification",
      "DMV Title History",
      "Safety Recall Status",
      "Online Listing History",
      "Junk & Salvage Information",
      "Accident Information",
    ],
  },
];

// Production PayPal client id
const paypalClientId = process.env.PAYPAL_CLIENT_ID || "AVQAmqIkWBYnRvMTTlS5Roe9ImglVk4knMmN3rAle6MckUCpasoPgc4Q-VW3gubpCUgNTr4OZR4jl6GG"

// Development PayPal client id
// const paypalClientId = process.env.PAYPAL_CLIENT_ID || "AeTkUF8rR1iqJnc6-LxjcuJUNAcNhieXUUVqv2D192Q70sYSbEa_ehqAMC6k1yxztsyZdTcDjqvKCjBL"

export const paypalScriptOptions = {
  clientId: paypalClientId,
  currency: "USD",
  intent: "capture" as const,
};
