#include <iostream>

int main() {
    int n; std::cin >> n;
    int a[12] = {}; int left[12]; int right[12];
    for (int i = 0; i < 12; i = i + 1) { left[i] = -1; right[i] = -1; }
    for (int i = 0; i < n; i = i + 1) { std::cin >> a[i]; }
    int root = -1; int size = 0;
    // 开始观察算法
    for (int i = 0; i < n; i = i + 1) {
        if (root == -1) { root = i; }
        else {
            int current = root;
            while (1) {
                if (a[i] < a[current]) {
                    if (left[current] == -1) { left[current] = i; break; }
                    current = left[current];
                } else {
                    if (right[current] == -1) { right[current] = i; break; }
                    current = right[current];
                }
            }
        }
        size = size + 1;
    }
    int target; std::cin >> target; int current = root;
    while (current != -1 && a[current] != target) {
        if (target < a[current]) { current = left[current]; }
        else { current = right[current]; }
    }
    if (current == -1) { std::cout << 0; } else { std::cout << 1; }
    std::cout << "\n";
    return 0;
}
