#include <iostream>
// @phase input
int main() {
    int first;
    int second;
    std::cin >> first >> second;
    // @phase domain
    if (first < -999 || first > 999 || second < -999 || second > 999) {
        std::cout << "DOMAIN\n";
        return 1;
    }
    // @phase normalize
    int a = first;
    int b = second;
    if (a < 0) { a = 0 - a; }
    if (b < 0) { b = 0 - b; }
    // @phase remainder
    while (b != 0) {
        int remainder = a % b;
        // @phase advance
        a = b;
        b = remainder;
    }
    // @phase finish
    std::cout << "GCD " << a << "\n";
    return 0;
}
