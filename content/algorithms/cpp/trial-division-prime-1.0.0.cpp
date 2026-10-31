#include <iostream>
// @phase input
int main() {
    int n;
    std::cin >> n;
    // @phase domain
    if (n < -999 || n > 999) {
        std::cout << "DOMAIN\n";
        return 1;
    }
    // @phase setup
    int isPrime = 0;
    int divisor = 0;
    int d = 2;
    // @phase classify
    if (n >= 2) {
        isPrime = 1;
        // @phase trial
        while (d <= n / d && isPrime == 1) {
            if (n % d == 0) {
                isPrime = 0;
                divisor = d;
            }
            // @phase advance
            d = d + 1;
        }
    }
    // @phase finish
    std::cout << "PRIME " << isPrime << "\n";
    return 0;
}
