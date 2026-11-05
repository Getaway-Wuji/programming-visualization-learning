#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    int count[21] = {};
    for (int i = 0; i < n; i = i + 1) { count[a[i]] = count[a[i]] + 1; }
    int at = 0;
    for (int value = 0; value <= 20; value = value + 1) {
        while (count[value] > 0) {
            a[at] = value; at = at + 1;
            count[value] = count[value] - 1;
        }
    }
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
