"use client"

import { Github, Send } from "lucide-react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"

export function Footer() {
  const locale = useLocale()
  const t = useTranslations("footer")
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 lg:px-8 max-w-[1600px] py-8 sm:py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600">
              SnapMail
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("description")}
            </p>
          </div>

          {/* Links */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("links.title")}
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link 
                  href={`/${locale}/about`} 
                  className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
                >
                  {t("links.about")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("legal.title")}
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link 
                  href={`/${locale}/privacy`} 
                  className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
                >
                  {t("legal.privacy")}
                </Link>
              </li>
              <li>
                <Link 
                  href={`/${locale}/terms`} 
                  className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
                >
                  {t("legal.terms")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("contact.title")}
            </h4>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/beilunyang/moemail"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>
              <a
                href="https://t.me/moecloudflare"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
                aria-label="Telegram"
              >
                <Send className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            © {currentYear} SnapMail. {t("copyright")}
          </p>
        </div>
      </div>
    </footer>
  )
}
