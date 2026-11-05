#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    for (int gap = n / 2; gap > 0; gap = gap / 2) {
        for (int i = gap; i < n; i = i + 1) {
            int value = a[i]; int j = i;
            while (j >= gap && a[j - gap] > value) {
                a[j] = a[j - gap]; j = j - gap;
            }
            a[j] = value;
        }
    }
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
