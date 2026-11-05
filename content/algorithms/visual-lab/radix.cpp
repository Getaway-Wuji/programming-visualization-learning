#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    int buffer[12] = {};
    int count[10] = {};
    for (int exp = 1; exp <= 100; exp = exp * 10) {
        for (int d = 0; d < 10; d = d + 1) { count[d] = 0; }
        for (int i = 0; i < n; i = i + 1) {
            int digit = a[i] / exp % 10; count[digit] = count[digit] + 1;
        }
        for (int d = 1; d < 10; d = d + 1) { count[d] = count[d] + count[d - 1]; }
        for (int i = n - 1; i >= 0; i = i - 1) {
            int digit = a[i] / exp % 10;
            count[digit] = count[digit] - 1;
            buffer[count[digit]] = a[i];
        }
        for (int i = 0; i < n; i = i + 1) { a[i] = buffer[i]; }
    }
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
