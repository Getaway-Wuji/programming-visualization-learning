#include <iostream>
// @phase input
int main() {
    int original;
    std::cin >> original;
    // @phase domain
    if (original < -999 || original > 999) {
        std::cout << "DOMAIN\n";
        return 1;
    }
    // @phase setup
    int working = original;
    int reversed = 0;
    int digit = 0;
    int palindrome = 0;
    // @phase classify
    if (original >= 0) {
        while (working > 0) {
            // @phase extract
            digit = working % 10;
            reversed = reversed * 10 + digit;
            working = working / 10;
        }
        // @phase compare
        if (reversed == original) { palindrome = 1; }
    }
    // @phase finish
    std::cout << "PALINDROME " << palindrome << "\n";
    return 0;
}
