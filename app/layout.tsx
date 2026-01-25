import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Trim Pro - Field Service Management',
  description: 'Production-ready FSM platform for millwork/trim/molding companies',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Emergency fix: Remove stuck dialog overlays on page load
                function removeStuckOverlays() {
                  try {
                    // Remove all closed Radix Dialog overlays (safely)
                    const overlays = document.querySelectorAll('[data-radix-dialog-overlay]');
                    overlays.forEach(function(overlay) {
                      const state = overlay.getAttribute('data-state');
                      const root = overlay.closest('[data-radix-dialog-root]');
                      
                      // Only remove if closed and orphaned
                      if (state === 'closed' && (!root || root.getAttribute('data-state') === 'closed')) {
                        const parent = overlay.parentNode;
                        // Only remove if parent exists and contains the overlay
                        if (parent && parent.contains(overlay)) {
                          try {
                            parent.removeChild(overlay);
                          } catch (e) {
                            // Node already removed, ignore
                          }
                        } else if (overlay.parentNode) {
                          // Fallback: use remove() if removeChild fails
                          try {
                            overlay.remove();
                          } catch (e) {
                            // Ignore errors
                          }
                        }
                      }
                    });
                    
                    // Remove any fixed overlay divs with black backgrounds that are stuck (safely)
                    const fixedOverlays = document.querySelectorAll('div');
                    fixedOverlays.forEach(function(div) {
                      try {
                        const styles = window.getComputedStyle(div);
                        if (styles.position === 'fixed' && 
                            styles.zIndex === '50' && 
                            (styles.backgroundColor.includes('rgb(0, 0, 0)') || styles.backgroundColor.includes('rgba(0, 0, 0'))) {
                          const hasDialogContent = div.parentElement && 
                            (div.parentElement.querySelector('[data-radix-dialog-content]') || 
                             div.closest('[data-radix-dialog-root]'));
                          if (!hasDialogContent) {
                            const parent = div.parentNode;
                            if (parent && parent.contains(div)) {
                              try {
                                parent.removeChild(div);
                              } catch (e) {
                                // Ignore errors
                              }
                            }
                          }
                        }
                      } catch (e) {
                        // Ignore errors for individual elements
                      }
                    });
                  } catch (e) {
                    // Ignore global errors
                  }
                }
                
                // Run after DOM is ready
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', removeStuckOverlays);
                } else {
                  setTimeout(removeStuckOverlays, 100);
                }
                
                // Run periodically but less aggressively
                setTimeout(function() {
                  setInterval(removeStuckOverlays, 3000);
                }, 1000);
              })();
            `,
          }}
        />
      </body>
    </html>
  )
}
