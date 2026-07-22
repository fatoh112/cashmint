import React from 'react';
import LandingHeader from './components/LandingHeader';
import HeroSection from './components/HeroSection';
import SystemShowcase from './components/SystemShowcase';
import FeaturesSection from './components/FeaturesSection';
import HowItWorksSection from './components/HowItWorksSection';
import PricingSection from './components/PricingSection';
import ContactSection from './components/ContactSection';
import LandingFooter from './components/LandingFooter';

export default function LandingPage({ onLoginClick }) {
  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-amber-500 selection:text-white transition-colors">
      <LandingHeader onLoginClick={onLoginClick} />
      
      <main>
        <HeroSection
          onPrimaryClick={() => scrollToSection('contact')}
          onSecondaryClick={() => scrollToSection('features')}
        />
        <SystemShowcase />
        <FeaturesSection />
        <HowItWorksSection />
        <PricingSection onOrderClick={() => scrollToSection('contact')} />
        <ContactSection />
      </main>

      <LandingFooter onLoginClick={onLoginClick} />
    </div>
  );
}
