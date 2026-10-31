#include <iostream>
// @phase setup
int main() {
    int n = {{n}};
    int values[30] = {};
    // @phase input
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> values[i];
    }
    // @phase gap
    for (int gap = n / 2; gap > 0; gap = gap / 2) {
        // @phase insert
        for (int i = gap; i < n; i = i + 1) {
            int key = values[i];
            int j = i;
            // @phase shift
            while (j >= gap && values[j - gap] > key) {
                values[j] = values[j - gap];
                j = j - gap;
            }
            // @phase place
            values[j] = key;
        }
    }
    // @phase output
    for (int i = 0; i < n; i = i + 1) {
        std::cout << values[i] << " ";
    }
    std::cout << "\n";
    return 0;
}
